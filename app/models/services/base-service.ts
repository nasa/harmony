import _ from 'lodash';
import { Logger } from 'winston';
import { v4 as uuid } from 'uuid';
import WorkItem from '../work-item';
import WorkflowStep from '../workflow-steps';
import InvocationResult from './invocation-result';
import { Job, JobStatus, statesToDefaultMessages } from '../job';
import DataOperation from '../data-operation';
import { defaultObjectStore } from '../../util/object-store';
import { RequestValidationError, ServerError } from '../../util/errors';
import db from '../../util/db';
import env from '../../util/env';
import { WorkItemStatus } from '../work-item-interface';
import { getRequestMetric } from '../../util/metrics';
import { getRequestUrl } from '../../util/url';
import HarmonyRequest from '../harmony-request';

export interface ServiceCapabilities {
  concatenation?: boolean;
  concatenate_by_default?: boolean;
  subsetting?: {
    bbox?: boolean;
    shape?: boolean;
    variable?: boolean;
    multiple_variable?: true;
  };
  output_formats?: string[];
  reprojection?: boolean;
}

export interface ServiceStep {
  image?: string;
  operations?: string[];
  conditional?: {
    exists?: string[];
    format?: string[];
  };
}

export interface ServiceCollection {
  id: string;
  granule_limit?: number;
  variables?: string[]
}

export interface ServiceConfig<ServiceParamType> {
  name?: string;
  max_batch_inputs?: number;
  is_batched?: boolean;
  data_operation_version?: string;
  granule_limit?: number;
  has_granule_limit?: boolean;
  default_sync?: boolean;
  type?: {
    name: string;
    params?: ServiceParamType;
  };
  umm_s?: string[];
  collections?: ServiceCollection[];
  capabilities?: ServiceCapabilities;
  concurrency?: number;
  message?: string;
  maximum_sync_granules?: number;
  steps?: ServiceStep[];
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

const conditionToOperationField = {
  reproject: 'crs',
  reformat: 'outputFormat',
  variableSubset: 'shouldVariableSubset',
  shapefileSubset: 'shouldShapefileSubset',
  spatialSubset: 'shouldSpatialSubset',
  temporalSubset: 'shouldTemporalSubset',
  concatenate: 'shouldConcatenate',
};

/**
 * Step operations that are aggregating steps
 */
const aggregatingOperations = [
  'concatenate',
];

/**
 * Returns true if the workflow step aggregates output from the previous step
 * (and therefore must wait for all output before executing)
 * @param step - the step in a workflow
 * @param operation - The operation
 * @returns true if the step is an aggregating step, false otherwise
 */
function stepHasAggregatedOutput(step: ServiceStep, operation: DataOperation): boolean {
  return operation.shouldConcatenate && _.intersection(aggregatingOperations, step.operations).length > 0;
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
function stepRequired(step: ServiceStep, operation: DataOperation): boolean {
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
      this.operation.stagingLocation = defaultObjectStore().getUrlString(env.stagingBucket, prefix);
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
    await this._createAndSaveWorkflow(job);

    const { isAsync, requestId } = job;
    const requestMetric = getRequestMetric(req, this.operation, this.config.name);
    logger.info(`Request metric for request ${requestId}`, { requestMetric: true, ...requestMetric } );
    this.operation.callback = `${env.callbackUrlRoot}/service/${requestId}`;
    return new Promise((resolve, reject) => {
      this._run(logger)
        .then((result) => {
          if (result) {
            // If running produces a result, use that rather than waiting for a callback
            resolve(result);
          } else if (isAsync) {
            resolve({ redirect: `/jobs/${requestId}`, headers: {} });
          } else {
            this._waitForSyncResponse(logger, requestId).then(resolve).catch(reject);
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
   * @param requestId - The request ID
   * @returns - An invocation result corresponding to a synchronous service response
   */
  protected async _waitForSyncResponse(
    logger: Logger,
    requestId: string,
  ): Promise<InvocationResult> {
    let result: InvocationResult;
    try {
      let job: Job;
      do {
        // Sleep and poll for completion.  We could also use SNS or similar for a faster response
        await new Promise((resolve) => setTimeout(resolve, env.syncRequestPollIntervalMs));
        ({ job } = await Job.byRequestId(db, requestId));
      } while (!job.isComplete());

      if (job.status === JobStatus.FAILED) {
        result = { error: job.message };
      }

      if (job.status === JobStatus.SUCCESSFUL) {
        const links = job.getRelatedLinks('data');
        if (links.length === 1) {
          result = { redirect: links[0].href };
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
    });
    if (this.operation.message) {
      job.setMessage(this.operation.message, JobStatus.SUCCESSFUL);
    }
    if (this.operation.message && !skipPreview) {
      job.setMessage(this.operation.message, JobStatus.RUNNING);
    }
    job.addStagingBucketLink(this.operation.stagingLocation);
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
    if ( this.operation.scrollIDs.length > 0 ) {
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
   * @param operation - the operation
   * @returns  the number of work items for the given step
   */
  protected _workItemCountForStep(step: ServiceStep, operation: DataOperation): number {
    const regex = /query\-cmr/;
    // query-cmr number of work items is a function of the page size and total granules
    if (step.image.match(regex)) {
      return Math.ceil(this.numInputGranules / env.cmrMaxPageSize);
    } else if (stepHasAggregatedOutput(step, operation)) {
      return 1;
    }
    return this.numInputGranules;
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
      let i = 0;
      this.config.steps.forEach(((step) => {
        if (stepRequired(step, this.operation)) {
          i += 1;
          workflowSteps.push(new WorkflowStep({
            jobID: this.operation.requestId,
            serviceID: serviceImageToId(step.image),
            stepIndex: i,
            workItemCount: this._workItemCountForStep(step, this.operation),
            operation: this.operation.serialize(
              this.config.data_operation_version,
              step.operations || [],
            ),
            hasAggregatedOutput: stepHasAggregatedOutput(step, this.operation),
          }));
        }
      }));
    } else {
      throw new RequestValidationError(`Service: ${this.config.name} does not yet support Turbo.`);
    }
    return workflowSteps;
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
    let firstStepWorkItems = [];

    if (this.isTurbo()) {
      this.logger.debug('Creating workflow steps');
      workflowSteps = this._createWorkflowSteps();
      firstStepWorkItems = this._createFirstStepWorkItems(workflowSteps[0]);
    }

    try {
      this.logger.info('timing.save-job-to-database.start');
      await db.transaction(async (tx) => {
        await job.save(tx);
        if (this.isTurbo()) {
          for await (const step of workflowSteps) {
            await step.save(tx);
          }
          for await (const workItem of firstStepWorkItems) {
            // use first step as the workflow step associated with each work item
            workItem.workflowStepIndex = workflowSteps[0].stepIndex;
            await workItem.save(tx);
          }
        }
      });

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
