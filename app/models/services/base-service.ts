import _ from 'lodash';
import { Logger } from 'winston';
import { v4 as uuid } from 'uuid';
import InvocationResult from './invocation-result';
import { Job, JobStatus } from '../job';
import DataOperation from '../data-operation';
import { defaultObjectStore } from '../../util/object-store';
import { ServerError } from '../../util/errors';
import db from '../../util/db';
import env from '../../util/env';

export interface ServiceCapabilities {
  subsetting?: {
    bbox?: boolean;
    variable?: boolean;
    multiple_variable?: true;
  };
  output_formats?: [string];
  reprojection?: boolean;
}

export interface ServiceConfig<ServiceParamType> {
  batch_size?: number;
  name?: string;
  data_operation_version?: string;
  type?: {
    name: string;
    params?: ServiceParamType;
  };
  data_url_pattern?: string;
  collections?: string[];
  capabilities?: ServiceCapabilities;
  concurrency?: number;
  message?: string;
  maximum_sync_granules?: number;
  maximum_async_granules?: number;
}

/**
 * Returns the maximum number of asynchronous granules a service allows
 * @param config the service configuration
 */
export function getMaxAsynchronousGranules(config: ServiceConfig<unknown>): number {
  const serviceLimit = _.get(config, 'maximum_async_granules', env.maxAsynchronousGranules);
  return Math.min(env.maxGranuleLimit, serviceLimit);
}

/**
 * Returns the maximum number of synchronous granules a service allows
 * @param config the service configuration
 */
export function getMaxSynchronousGranules(config: ServiceConfig<unknown>): number {
  const serviceLimit = _.get(config, 'maximum_sync_granules', env.maxSynchronousGranules);
  return Math.min(env.maxGranuleLimit, serviceLimit);
}

/**
 * Serialize the given operation with the given config.
 * @param op The operation to serialize
 * @param config The config to use when serializing the operation
 * @returns The serialized operation
 */
export function functionalSerializeOperation(
  op: DataOperation,
  config: ServiceConfig<unknown>,
): string {
  return op.serialize(config.data_operation_version, config.data_url_pattern);
}

/**
 * Abstract base class for services.  Provides a basic interface and handling of backend response
 * callback plumbing.
 *
 * @class BaseService
 * @abstract
 */
export default abstract class BaseService<ServiceParamType> {
  config: ServiceConfig<ServiceParamType>;

  params: ServiceParamType;

  operation: DataOperation;

  invocation: Promise<boolean>;

  message?: string;

  /**
   * Creates an instance of BaseService.
   * @param {object} config The service configuration from config/services.yml
   * @param {DataOperation} operation The data operation being requested of the service
   * @memberof BaseService
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
    this.message = config.message;
  }

  /**
   * Returns the capabilities as specified in config/services.yml
   *
   * @readonly
   * @memberof BaseService
   * @returns {object} The service capabilities
   */
  get capabilities(): ServiceCapabilities {
    return this.config.capabilities;
  }

  /**
   * Invokes the service, returning a promise for the invocation result
   *
   * @param {Logger} logger The logger associated with this request
   * @param {String} harmonyRoot The harmony root URL
   * @param {String} requestUrl The URL the end user invoked
   *
   * @returns {Promise<InvocationResult>} A promise resolving to the result of the callback.
   * @memberof BaseService
   */
  async invoke(
    logger?: Logger, harmonyRoot?: string, requestUrl?: string,
  ): Promise<InvocationResult> {
    let job: Job;
    logger.info(`Invoking service for operation ${JSON.stringify(this.operation)}`);
    try {
      job = await this._createJob(logger, requestUrl, this.operation.stagingLocation);
      await job.save(db);
    } catch (e) {
      logger.error(e.stack);
      throw new ServerError('Failed to save job to database.');
    }

    const { isAsync, requestId } = job;
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
        job = await Job.byRequestId(db, requestId);
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
   * @param {Logger} _logger the logger associated with the request
   * @memberof BaseService
   * @returns {Promise<InvocationResult>}
   */
  protected abstract async _run(_logger: Logger): Promise<InvocationResult>;

  /**
   * Creates a new job for this service's operation, with appropriate logging, errors,
   * and warnings.
   *
   * @param {knex.Transaction} transaction The transaction to use when creating the job
   * @param {Logger} logger The logger associated with this request
   * @param {String} requestUrl The URL the end user invoked
   * @param {String} stagingLocation The staging location for this job
   * @returns {Job} The created job
   * @memberof BaseService
   * @throws {ServerError} if the job cannot be created
   */
  protected async _createJob(
    logger: Logger,
    requestUrl: string,
    stagingLocation: string,
  ): Promise<Job> {
    const { requestId, user } = this.operation;
    logger.info(`Creating job for ${requestId}`);
    const job = new Job({
      username: user,
      requestId,
      status: JobStatus.RUNNING,
      request: requestUrl,
      isAsync: !this.isSynchronous,
    });
    job.addStagingBucketLink(stagingLocation);
    if (this.message) {
      job.message = this.warningMessage ? `${this.message} ${this.warningMessage}` : this.message;
    } else if (this.warningMessage) {
      job.message = this.warningMessage;
    }
    return job;
  }

  /**
   * Returns true if a request should be handled synchronously, false otherwise
   *
   * @returns {boolean} true if the request is synchronous, false otherwise
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

    let numResults = this.operation.cmrHits;

    if (operation.maxResults) {
      numResults = Math.min(numResults, operation.maxResults);
    }

    return numResults <= this.maxSynchronousGranules;
  }

  /**
   * Returns the maximum number of asynchronous granules for this service
   * @memberof BaseService
   */
  get maxAsynchronousGranules(): number {
    return getMaxAsynchronousGranules(this.config);
  }

  /**
   * Returns the maximum number of synchronous granules for this service
   * @memberof BaseService
   */
  get maxSynchronousGranules(): number {
    return getMaxSynchronousGranules(this.config);
  }

  /**
   * Returns a warning message if some part of the request can't be fulfilled
   *
   * @returns {string} a warning message to display, or undefined if not applicable
   * @readonly
   * @memberof BaseService
   */
  get warningMessage(): string {
    const maxResultsLimited = (this.operation.maxResults
      && this.maxAsynchronousGranules > this.operation.maxResults
      && this.operation.cmrHits > this.operation.maxResults);

    let message;
    if (maxResultsLimited) {
      message = `CMR query identified ${this.operation.cmrHits} granules, but the request has been limited `
      + `using maxResults to process only the first ${this.operation.maxResults} granules.`;
    } else if (this.operation.cmrHits > this.maxAsynchronousGranules) {
      message = `CMR query identified ${this.operation.cmrHits} granules, but the request has been limited `
        + `to process only the first ${this.maxAsynchronousGranules} granules.`;
    }
    return message;
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
