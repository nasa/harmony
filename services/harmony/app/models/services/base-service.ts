import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import { Logger } from 'winston';

import { joinTexts } from '@harmony/util/string';

import { QUERY_CMR_SERVICE_REGEX } from '../../backends/workflow-orchestration/util';
import { makeWorkScheduleRequest } from '../../backends/workflow-orchestration/work-item-polling';
import db from '../../util/db';
import env from '../../util/env';
import { RequestValidationError, ServerError } from '../../util/errors';
import { getRequestMetric } from '../../util/metrics';
import { defaultObjectStore } from '../../util/object-store';
import { getRequestUrl } from '../../util/url';
import DataOperation from '../data-operation';
import HarmonyRequest from '../harmony-request';
import { Job, JobStatus, statesToDefaultMessages } from '../job';
import UserWork from '../user-work';
import WorkItem from '../work-item';
import { WorkItemStatus } from '../work-item-interface';
import WorkflowStep from '../workflow-steps';
import InvocationResult from './invocation-result';

export interface ServiceCapabilities {
  concatenation?: boolean;
  concatenate_by_default?: boolean;
  subsetting?: {
    bbox?: boolean;
    shape?: boolean;
    temporal?: boolean;
    variable?: boolean;
    multiple_variable?: true;
  };
  averaging?: {
    time?: boolean;
    area?: boolean;
  };
  output_formats?: string[];
  reprojection?: boolean;
  extend?: boolean;
  default_extend_dimensions?: string[];
  all_collections?: boolean;
}

export interface ServiceStep {
  image?: string;
  operations?: string[];
  max_batch_inputs?: number;
  max_batch_size_in_bytes?: number;
  is_batched?: boolean;
  is_sequential?: boolean;
  conditional?: {
    exists?: string[];
    format?: string[];
    umm_c?: {
      native_format?: string[];
    };
  };
  extra_args?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // Allow any string key and any value type
  };
}

export interface ServiceCollection {
  id: string;
  granule_limit?: number;
  variables?: string[];
}

export interface ServiceConfig<ServiceParamType> {
  name?: string;
  description?: string;
  data_operation_version?: string;
  granule_limit?: number;
  has_granule_limit?: boolean;
  default_sync?: boolean;
  type?: {
    name: string;
    params?: ServiceParamType;
  };
  umm_s?: string;
  collections?: ServiceCollection[];
  capabilities?: ServiceCapabilities;
  concurrency?: number;
  message?: string;
  maximum_sync_granules?: number;
  steps?: ServiceStep[];
  validate_variables?: boolean;
  external_validation_url?: string;
}

/**
 * Returns the maximum number of synchronous granules a service allows
 * @param config - the service configuration
 */
export function getMaxSynchronousGranules(config: ServiceConfig<unknown>): number {
  const serviceLimit = _.get(config, 'maximum_sync_granules', env.maxSynchronousGranules);
  return Math.min(env.maxGranuleLimit, serviceLimit);
}

/**
 * Serialize the given operation with the given config.
 * @param op - The operation to serialize
 * @param config - The config to use when serializing the operation
 * @returns The serialized operation
 */
export function functionalSerializeOperation(
  op: DataOperation,
  config: ServiceConfig<unknown>,
): string {
  return op.serialize(config.data_operation_version);
}

/**
 * Takes a docker image name for a service and returns the service ID for that image.
 *
 * @param image - the docker image for the service
 * @returns the service ID for that image.
 */
function serviceImageToId(image: string): string {
  return image;
}

export const conditionToOperationField = {
  concatenate: 'shouldConcatenate',
  dimensionSubset: 'shouldDimensionSubset',
  extend: 'shouldExtend',
  reformat: 'outputFormat',
  reproject: 'crs',
  shapefileSubset: 'shouldShapefileSubset',
  spatialSubset: 'shouldSpatialSubset',
  temporalSubset: 'shouldTemporalSubset',
  variableSubset: 'shouldVariableSubset',
};

/**
 * Step operations that can take more than one catalog as input.
 * Most operations can only take one catalog.
 */
const multiCatalogOperations = [
  'concatenate',
];

/**
 * Returns true if the workflow step uses more than one input catalog
 * (and therefore must wait for all output from the previous step before executing)
 * @param step - the step in a workflow
 * @param operation - The operation
 * @returns true if the step uses more than one input catalog, false otherwise
 */
export function stepUsesMultipleInputCatalogs(step: ServiceStep, operation: DataOperation): boolean {
  // get the operations for this step that support multiple input catalogs
  const multiCatOps = _.intersection(multiCatalogOperations, step.operations);

  // check to see if the user has actually requested any of the multi-catalog operations
  for (const op of multiCatOps) {
    const should = conditionToOperationField[op];
    if (operation[should]) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if the workflow step is required for the given operation. If any
 * of the conditional exists operations are present in the operation then the step
 * will be considered required. If any of the conditional formats are requested in
 * the operation the step will be considered required. If both a list of formats
 * and a list of operations are provided both the formats must include the format
 * requested by the operation and one of the required operations must be present in
 * the request in order to require the step.
 *
 * @param step - The workflow step
 * @param operation - The operation
 *
 * @returns true if the workflow step is required
 */
export function stepRequired(step: ServiceStep, operation: DataOperation): boolean {
  let required = true;
  if (step.conditional?.exists?.length > 0) {
    required = false;
    for (const condition of step.conditional.exists) {
      if (operation[conditionToOperationField[condition]]) {
        required = true;
      }
    }
  }
  if (required && step.conditional?.format) {
    required = false;
    if (step.conditional.format.includes(operation.outputFormat)) {
      required = true;
    }
  }
  if (required && step.conditional?.umm_c) {
    if (step.conditional.umm_c.native_format) {
      required = false;
      const fileArchiveInfo = operation.ummCollections[0].umm.ArchiveAndDistributionInformation?.FileArchiveInformation;
      const nativeFormat = fileArchiveInfo?.filter((a) => a.FormatType = 'Native')[0]?.Format;
      if (nativeFormat && step.conditional.umm_c.native_format.includes(nativeFormat.toLowerCase())) {
        required = true;
      }
    }
  }

  if (
    required &&
    step.conditional?.exists?.includes('extend') &&
    (!operation.extendDimensions || operation.extendDimensions.length === 0) &&
    step.conditional?.exists.includes('concatenate')
  ) {
    // Special temporary case which can occur if extend=false is specified and the step is
    // configured to run if either extend or concatenate is provided. Once EDSC is updated to be
    // able to provide the extend parameter and not use concatenate as a proxy we can remove
    // this case.
    required = false;
  }
  return required;
}

/**
 * Abstract base class for services.  Provides a basic interface and handling of backend response
 * callback plumbing.
 *
 */
export default abstract class BaseService<ServiceParamType> {
  config: ServiceConfig<ServiceParamType>;

  params: ServiceParamType;

  operation: DataOperation;

  invocation: Promise<boolean>;

  logger: Logger;

  /**
   * Creates an instance of BaseService.
   * @param config - The service configuration from config/services.yml
   * @param operation - The data operation being requested of the service
   */
  constructor(config: ServiceConfig<ServiceParamType>, operation: DataOperation) {
    this.config = config;
    const { type } = this.config;
    this.params = type?.params || ({} as ServiceParamType);
    this.operation = operation;
    this.operation.isSynchronous = this.isSynchronous;

    if (!this.operation.stagingLocation) {
      const prefix = `public/${config.name || this.constructor.name}/${uuid()}/`;
      this.operation.stagingLocation = defaultObjectStore().getUrlString({ bucket: env.artifactBucket, key: prefix });
    }
  }

  /**
   * Returns the capabilities as specified in config/services.yml
   *
   * @readonly
   * @returns The service capabilities
   */
  get capabilities(): ServiceCapabilities {
    return this.config.capabilities;
  }

  /**
   * Returns the final staging location of the service.
   *
   * @returns the final staging location of the service
   */
  finalStagingLocation(): string {
    const { requestId, destinationUrl } = this.operation;
    if (destinationUrl) {
      let destPath = destinationUrl.substring(5);
      destPath = destPath.endsWith('/') ? destPath.slice(0, -1) : destPath;
      return defaultObjectStore().getUrlString({ bucket: destPath, key: requestId + '/' });
    }
    return defaultObjectStore().getUrlString({ bucket: env.stagingBucket, key: `public/${requestId}/` });
  }

  /**
   * Invokes the service, returning a promise for the invocation result
   *
   * @param logger - The logger associated with this request
   * @param harmonyRoot - The harmony root URL
   * @param requestUrl - The URL the end user invoked
   *
   * @returns A promise resolving to the result of the callback.
   */
  async invoke(req: HarmonyRequest, logger?: Logger): Promise<InvocationResult> {
    this.logger = logger;
    logger.info('Invoking service for operation', { operation: this.operation });
    // TODO handle the skipPreview parameter here when implementing HARMONY-1129
    const job = this._createJob(getRequestUrl(req));
    const labels = req.body.label;
    job.labels = labels || [];

    await this._createAndSaveWorkflow(job);

    const { isAsync, jobID } = job;
    const requestMetric = getRequestMetric(req, this.operation, this.config.name);
    logger.info(`Request metric for request ${jobID}`, { requestMetric: true, ...requestMetric });
    this.operation.callback = `${env.callbackUrlRoot}/service/${jobID}`;
    return new Promise((resolve, reject) => {
      this._run(logger)
        .then((result) => {
          if (result) {
            // If running produces a result, use that rather than waiting for a callback
            resolve(result);
          } else if (isAsync) {
            resolve({ redirect: `/jobs/${jobID}`, headers: {} });
          } else {
            this._waitForSyncResponse(logger, jobID).then(resolve).catch(reject);
          }
        })
        .catch(reject);
    });
  }

  /**
   * Waits for a synchronous service invocation to complete by polling its job record,
   * then returns its result
   *
   * @param logger - The logger used for the request
   * @param jobID - The job ID
   * @returns - An invocation result corresponding to a synchronous service response
   */
  protected async _waitForSyncResponse(
    logger: Logger,
    jobID: string,
  ): Promise<InvocationResult> {
    let result: InvocationResult;
    try {
      let job: Job;
      do {
        // Sleep and poll for completion.  We could also use SNS or similar for a faster response
        await new Promise((resolve) => setTimeout(resolve, env.syncRequestPollIntervalMs));
        ({ job } = await Job.byJobID(db, jobID, true, true, true));
      } while (!job.hasTerminalStatus());

      if (job.status === JobStatus.FAILED) {
        result = { error: job.message };
      }

      if (job.status === JobStatus.SUCCESSFUL) {
        const links = job.getRelatedLinks('data');
        if (links.length === 1) {
          result = { redirect: links[0].href };
        } else if (links.length === 0) {
          result = { redirect: `/jobs/${jobID}`, headers: {} };
        } else {
          result = { error: `The backend service provided ${links.length} outputs when 1 was required`, statusCode: 500 };
        }
      }
    } catch (e) {
      logger.error(e);
      result = { error: 'The service request failed due to an internal error', statusCode: 500 };
    }
    return result;
  }

  /**
   * Abstract method used by invoke() to simplify implementation of async invocations.
   * Subclasses must implement this method if using the default invoke() implementation.
   * The method will be invoked asynchronously, completing when the service's callback is
   * received.
   * @param _logger - the logger associated with the request
   */
  protected abstract _run(_logger: Logger): Promise<InvocationResult>;

  /**
   * Creates a new job object for this service's operation
   *
   * @param requestUrl - The URL the end user invoked
   * @returns The created job
   * @throws ServerError - if the job cannot be created
   */
  protected _createJob(
    requestUrl: string,
  ): Job {
    const url = new URL(requestUrl);
    const skipPreviewStr = url.searchParams.get('skipPreview');
    const skipPreview =
      (this.numInputGranules < env.previewThreshold) ||
      (skipPreviewStr && skipPreviewStr.toLowerCase() === 'true');
    const defaultMessage = statesToDefaultMessages[JobStatus.PREVIEWING];
    const message = skipPreview ?
      this.operation.message :
      this.operation.message ? [defaultMessage, this.operation.message].join('. ') : defaultMessage;

    const { requestId, user } = this.operation;
    const job = new Job({
      username: user,
      requestId,
      jobID: requestId,
      status: skipPreview ? JobStatus.RUNNING : JobStatus.PREVIEWING,
      request: requestUrl,
      isAsync: !this.isSynchronous,
      numInputGranules: this.numInputGranules,
      message: message,
      collectionIds: this.operation.collectionIds,
      ignoreErrors: this.operation.ignoreErrors,
      destination_url: this.operation.destinationUrl,
      service_name: this.config.name,
      provider_id: this.operation.providerId,
    });
    if (this.operation.message) {
      job.setMessage(this.operation.message, JobStatus.SUCCESSFUL);
    }
    if (this.operation.message && !skipPreview) {
      job.setMessage(this.operation.message, JobStatus.RUNNING);
    }
    if (this.operation.destinationUrl) {
      const destinationWarningSuccessful = 'The results have been placed in the requested custom destination. Any further changes to the result files or their location are outside of Harmony\'s control.';
      const destinationWarningRunning = 'Once results are sent to the requested destination, any changes to the result files or their location are outside of Harmony\'s control.';
      job.setMessage(joinTexts(job.getMessage(JobStatus.SUCCESSFUL), destinationWarningSuccessful), JobStatus.SUCCESSFUL);
      job.setMessage(joinTexts(job.getMessage(JobStatus.RUNNING), destinationWarningRunning), JobStatus.RUNNING);
    }
    if (!this.operation.destinationUrl) {
      job.addStagingBucketLink(this.finalStagingLocation());
    }
    return job;
  }

  /**
   * Creates a new work item object which will kick off the first task for this request
   * @param workflowStep - The step to create the work item for
   * @returns The created WorkItem for the query CMR job
   * @throws ServerError - if the work item cannot be created
   */
  protected _createFirstStepWorkItems(workflowStep: WorkflowStep): WorkItem[] {
    const workItems = [];
    if (this.operation.scrollIDs.length > 0) {
      for (const scrollID of this.operation.scrollIDs) {
        workItems.push(new WorkItem({
          jobID: this.operation.requestId,
          scrollID,
          serviceID: workflowStep.serviceID,
          status: WorkItemStatus.READY,
        }));
      }
    } else {
      workItems.push(new WorkItem({
        jobID: this.operation.requestId,
        serviceID: workflowStep.serviceID,
        status: WorkItemStatus.READY,
      }));
    }

    return workItems;
  }

  /**
   * Return the number of work items that should be created for a given step
   *
   * @param step - workflow service step
   * @returns  the number of work items for the given step
   */
  protected _workItemCountForStep(step: ServiceStep): number {
    const regex = /query\-cmr/;
    // query-cmr number of work items is a function of the page size and total granules
    if (step.image.match(regex)) {
      return Math.ceil(this.numInputGranules / env.cmrMaxPageSize);
    }
    // the rest will get filled in as we go
    return 0;
  }

  /**
   * Return the number of actual workflow steps for this request
   *
   * @returns  the number of actual workflow steps
   */
  protected _numActualSteps(): number {
    let totalSteps = 0;
    if (this.config.steps) {
      this.config.steps.forEach(((step) => {
        if (stepRequired(step, this.operation)) {
          totalSteps += 1;
        }
      }));
    }
    return totalSteps;
  }

  /**
   * Creates the workflow steps objects for this request
   *
   * @returns The created WorkItem for the query CMR job
   * @throws ServerError - if the work item cannot be created
   */
  protected _createWorkflowSteps(): WorkflowStep[] {
    const workflowSteps = [];
    if (this.config.steps) {
      const numSteps = this._numActualSteps();
      let i = 0;
      this.config.steps.forEach(((step) => {
        if (stepRequired(step, this.operation)) {
          i += 1;
          if (i === numSteps) {
            this.operation.stagingLocation = this.finalStagingLocation();
          }

          if (step.extra_args) {
            this.operation.extraArgs = step.extra_args;
          } else {
            // clear out extraArgs used by other steps
            this.operation.removeExtraArgs();
          }

          let progressWeight = 1.0;
          if (QUERY_CMR_SERVICE_REGEX.test(step.image)) {
            progressWeight = 0.1;
          }
          workflowSteps.push(new WorkflowStep({
            jobID: this.operation.requestId,
            serviceID: serviceImageToId(step.image),
            stepIndex: i,
            workItemCount: this._workItemCountForStep(step),
            operation: this.operation.serialize(
              this.config.data_operation_version,
              step.operations || [],
            ),
            hasAggregatedOutput: stepUsesMultipleInputCatalogs(step, this.operation),
            isBatched: !!step.is_batched && this.operation.shouldConcatenate,
            is_sequential: !!step.is_sequential,
            maxBatchInputs: step.max_batch_inputs,
            maxBatchSizeInBytes: step.max_batch_size_in_bytes,
            progress_weight: progressWeight,
          }));
        }
      }));
    } else {
      throw new RequestValidationError(`Service: ${this.config.name} does not yet support Turbo.`);
    }
    return workflowSteps;
  }

  /**
   * Creates the user work objects for this request
   *
   * @returns The created user work entries
   * @throws ServerError - if the user work entries cannot be created
   */
  protected _createUserWorkEntries(): UserWork[] {
    const userWorkEntries = [];
    if (this.config.steps) {
      this.config.steps.forEach(((step) => {
        if (stepRequired(step, this.operation)) {
          userWorkEntries.push(new UserWork({
            job_id: this.operation.requestId,
            service_id: serviceImageToId(step.image),
            username: this.operation.user,
            ready_count: 0,
            running_count: 0,
            is_async: !this.isSynchronous,
            last_worked: new Date(),
          }));
        }
      }));
    } else {
      throw new RequestValidationError(`Service: ${this.config.name} does not yet support Turbo.`);
    }
    return userWorkEntries;
  }

  /**
   *  Check to see if the service is invoked in turbo mode
   *  Default to true and the child class can over write it on demand
   * @returns true if the service is being invoked in turbo mode
   */
  protected isTurbo(): boolean {
    return true;
  }

  /**
   * Creates all of the database entries associated with starting a workflow
   *
   * @param service - The instantiation of a service for this operation
   * @param configuration - The service configuration
   * @param requestUrl - the request the end user sent
   */
  protected async _createAndSaveWorkflow(
    job: Job,
  ): Promise<void> {
    const startTime = new Date().getTime();
    let workflowSteps = [];
    let userWorkEntries = [];
    let firstStepWorkItems = [];

    if (this.isTurbo()) {
      this.logger.debug('Creating workflow steps, user work rows, and initial work items');
      workflowSteps = this._createWorkflowSteps();
      userWorkEntries = this._createUserWorkEntries();
      firstStepWorkItems = this._createFirstStepWorkItems(workflowSteps[0]);
      userWorkEntries[0].ready_count += firstStepWorkItems.length;
    }

    try {
      this.logger.info('timing.save-job-to-database.start');
      await db.transaction(async (tx) => {
        await job.save(tx);
        if (this.isTurbo()) {
          for await (const step of workflowSteps) {
            await step.save(tx);
          }
          for await (const userWork of userWorkEntries) {
            await userWork.save(tx);
          }
          for await (const workItem of firstStepWorkItems) {
            // use first step as the workflow step associated with each work item
            workItem.workflowStepIndex = workflowSteps[0].stepIndex;
            await workItem.save(tx);
          }
          this.logger.info('Created first step work items.');
        }
      });

      if (workflowSteps && workflowSteps.length > 0) {
        // ask the scheduler to schedule the new work items
        await makeWorkScheduleRequest(workflowSteps[0].serviceID);
      }

      const durationMs = new Date().getTime() - startTime;
      this.logger.info('timing.save-job-to-database.end', { durationMs });
    } catch (e) {
      this.logger.error(e.stack);
      throw new ServerError('Failed to save job to database.');
    }
  }

  /**
   * Returns true if a request should be handled synchronously, false otherwise
   *
   * @returns true if the request is synchronous, false otherwise
   *
   */
  get isSynchronous(): boolean {
    const { operation } = this;

    if (operation.requireSynchronous) {
      return true;
    }
    if (operation.destinationUrl) {
      return false;
    }
    if (operation.isSynchronous !== undefined) {
      return operation.isSynchronous;
    }

    if (this.config.default_sync !== undefined) return this.config.default_sync;

    // If first step is not query-cmr, cmrHits will not be set in operation
    // set numResults to be a huge number in this case
    let numResults = this.operation.cmrHits || Number.MAX_SAFE_INTEGER;

    if (operation.maxResults) {
      numResults = Math.min(numResults, operation.maxResults);
    }

    return numResults <= this.maxSynchronousGranules;
  }

  /**
   * Returns the maximum number of synchronous granules for this service
   */
  get maxSynchronousGranules(): number {
    return getMaxSynchronousGranules(this.config);
  }

  /**
   * Returns the number of input granules for this operation
   *
   * @returns the number of input granules for this operation
   * @readonly
   */
  get numInputGranules(): number {
    return Math.min(this.operation.cmrHits,
      this.operation.maxResults || Number.MAX_SAFE_INTEGER,
      env.maxGranuleLimit);
  }

  /**
   * Return the message to be sent to the service, describing the operation to be performed
   *
   * @returns the serialized message to be sent
   */
  serializeOperation(): string {
    const { operation, config } = this;
    return functionalSerializeOperation(operation, config);
  }
}
