import PromiseQueue from 'p-queue';
import BaseService, { ServiceConfig } from 'models/services/base-service';
import { Logger } from 'winston';

import { Job } from 'models/job';
import { ServiceError } from '../../util/errors';
import { objectStoreForProtocol } from '../../util/object-store';
import DataOperation from '../data-operation';
import InvocationResult from './invocation-result';

import db from '../../util/db';
import { updateJobFields, CallbackQueryItem } from '../../backends/service-response';

/**
 * A wrapper for a service that takes a service class for a service that is only able
 * to handle synchronous requests and feeds it granules one-at-a-time, aggregating the
 * results, effectively making it asynchronous
 *
 * @deprecated Only usable for sync HTTP requests, currently.  To be removed after PO.DAAC migration
 * @class AsynchronizerService
 * @extends {BaseService}
 */
export default class AsynchronizerService<ServiceParamType> extends BaseService<ServiceParamType> {
  SyncServiceClass: { new(...args: unknown[]): BaseService<ServiceParamType> };

  queue: PromiseQueue;

  completionPromise: Promise<boolean>;

  completedCount: number;

  totalCount: number;

  private _completionCallbacks: {
    resolve: (value?: unknown) => void; reject: (reason?: string) => void;
  };

  _invokeArgs: [Logger, string, string];

  isComplete: boolean;

  constructor(
    SyncServiceClass: { new(...args: unknown[]): BaseService<ServiceParamType> },
    config: ServiceConfig<ServiceParamType>,
    operation: DataOperation,
  ) {
    super(config, operation);
    this.SyncServiceClass = SyncServiceClass;
    const concurrency = this.config.concurrency || 1;
    if (concurrency !== 1 && this.config.type?.single_granule_requests) {
      throw new TypeError(`Single granule request services must have concurrency set to 1, but was set to ${concurrency}`);
    }
    this.queue = new PromiseQueue({ concurrency });
    this.completionPromise = new Promise((resolve, reject) => {
      this._completionCallbacks = { resolve, reject };
    });
  }

  /**
   * Invokes the service, delegating directly for sync requests or converting to async for
   * async
   *
   * @param {Logger} logger The logger to use for details about this request
   * @param {string} harmonyRoot The harmony root URL
   * @param {string} requestUrl The request's URL to record in Job records
   * @returns {Promise<object>} A promise for the invocation result. @see BaseService#invoke
   * @memberof AsynchronizerService
   */
  async invoke(logger: Logger, harmonyRoot: string, requestUrl: string): Promise<InvocationResult> {
    this._invokeArgs = [logger, harmonyRoot, requestUrl];
    if (this.isSynchronous) {
      try {
        const delegate = new this.SyncServiceClass(this.config, this.operation);
        const result = await delegate.invoke(...this._invokeArgs);
        this.isComplete = true;
        if (result.error) {
          this._completionCallbacks.reject(result.error);
        } else {
          this._completionCallbacks.resolve(true);
        }
        return result;
      } catch (e) {
        this._completionCallbacks.reject(e.message);
        throw e;
      }
    }
    return super.invoke(...this._invokeArgs);
  }

  /**
   * Runs the service, asynchronous at this point
   *
   * @param {Logger} logger The logger to use for details about this request
   * @returns {Promise<InvocationResult>}
   * @memberof AsynchronizerService
   */
  async _run(logger: Logger): Promise<InvocationResult> {
    const { user, requestId } = this.operation;
    const job = await Job.byUsernameAndRequestId(db, user, requestId);
    try {
      logger.info('Running asynchronously');
      const operations = this._getSyncOperations();
      this.isComplete = false;
      this.completedCount = 0;
      this.totalCount = operations.length;
      for (const { name, syncOperation } of operations) {
        const invokeServiceOnQueue = this.queue.add(
          () => this._invokeServiceSync(logger, job, name, syncOperation),
        );
        if (this.config.type?.synchronous_only) {
          await invokeServiceOnQueue;
        }
      }
      // for (const { name, syncOperation } of operations) {
      //   if (this.config.type.synchronous_only) {
      //     await this.queue.add(() => this._invokeServiceSync(logger, job, name, syncOperation));
      //   } else {
      //     this.queue.add(() => this._invokeServiceSync(logger, job, name, syncOperation));
      //   }
      // }
      if (this.config.type?.synchronous_only) {
        await this.queue.onIdle();
        await this._succeed(logger, job);
      }
    } catch (e) {
      logger.error(e);
      const message = (e instanceof ServiceError) ? e.message : 'An unexpected error occurred';
      this._fail(logger, job, message);
    }
    return null;
  }

  /**
   * Builds a list of synchronous data operations from this invocation's operation, where
   * each operation has a single granule and is marked for synchronous invocation.
   *
   * @returns {DataOperation[]} synchronous, single-granule operations
   * @memberof AsynchronizerService
   */
  _getSyncOperations(): Array<{name: string; syncOperation: DataOperation}> {
    const result: Array<{name: string; syncOperation: DataOperation}> = [];
    for (const source of this.operation.sources) {
      for (const granule of source.granules) {
        const op = this.operation.clone();
        op.isSynchronous = true;
        op.requestId += `-${granule.id}`;
        op.callback += `-${granule.id}`;
        op.requireSynchronous = true;
        op.sources = [{
          collection: source.collection,
          variables: source.variables,
          granules: [granule],
        }];
        result.push({ name: granule.name, syncOperation: op });
      }
    }
    return result;
  }

  /**
   * Invokes the synchronous backend service using the given operation, storing
   * results on the provided job
   *
   * @param {Logger} logger The logger to use for details about this request
   * @param {Job} job The job containing all service invocations
   * @param {string} name The name of the granule in the operation
   * @param {DataOperation} syncOperation The synchronous, single-granule op to invoke
   * @returns {void}
   * @throws {ServiceError} If the service calls back with an error or incorrectly
   * @memberof AsynchronizerService
   */
  async _invokeServiceSync(logger: Logger, job: Job, name: string, syncOperation: DataOperation):
  Promise<void> {
    logger.info(`Invoking service on ${name}`);
    const service = new this.SyncServiceClass(this.config, syncOperation);
    const result = await service.invoke(...this._invokeArgs);

    try {
      if (result.error) {
        throw new ServiceError(result.statusCode || 400, result.error);
      }

      const granule = syncOperation.sources[0].granules[0];
      const item: CallbackQueryItem = {
        type: 'application/octet-stream', // Generic default in case we can't find anything else
        temporal: granule.temporal && [granule.temporal.start, granule.temporal.end].join(','),
        bbox: granule.bbox && granule.bbox.join(','),
        href: null,
        rel: 'data',
      };

      const { stagingLocation } = this.operation;

      if (result.stream) {
        // Result is streaming bytes back.  Put it in the object store and record its location.
        const store = objectStoreForProtocol(stagingLocation);
        if (result.headers['content-type'] && result.headers['content-type'] !== 'application/x-www-form-urlencoded') {
          item.type = result.headers['content-type'] || item.type;
        }
        let filename = `${name}_processed`; // Unfortunately the most we can say by default
        // Try pulling a filename from the Content-Disposition header
        if (result.headers['content-disposition']) {
          const filenameMatch = result.headers['content-disposition'].match(/filename="([^"]+)"/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        }
        item.href = stagingLocation + filename;
        logger.info(`Staging to ${item.href}`);
        await store.upload(result.stream, item.href, result.headers['content-length'], item.type);
      } else if (result.redirect) {
        // Result is a redirect.  Record its location and query its content type.
        const store = objectStoreForProtocol(result.redirect);
        if (store) { // Not an HTTPS URL
          const metadata = await store.headObject(result.redirect);
          item.type = metadata.ContentType || (metadata.Metadata && metadata.Metadata['Content-Type']) || item.type;
        }
        item.href = result.redirect;
      } else {
        throw new ServiceError(500, 'The backend service did not respond correctly');
      }

      this.completedCount += 1;
      const progress = Math.round(100 * (this.completedCount / this.totalCount)).toString();

      // Not threadsafe. There's a race condition in this check if we ever allow more than
      // one granule to process in parallel for a split up request
      if (this.completedCount === this.totalCount && this.config.type?.single_granule_requests) {
        this._succeed(logger, job);
      } else {
        updateJobFields(logger, job, { item, progress });
        await job.save(db);
      }
      logger.info(`Completed service on ${name}. Request is ${progress}% complete.`);
    } finally {
      if (result.onComplete) {
        result.onComplete();
      }
    }
  }

  /**
   * Marks the service call as complete and successful
   *
   * @param {Logger} logger The logger to use for details about this request
   * @param {Job} job The job containing all service invocations
   * @returns {Promise<void>}
   * @memberof AsynchronizerService
   */
  async _succeed(logger: Logger, job: Job): Promise<void> {
    if (this.isComplete) {
      logger.warn('Received a success call for a completed job');
      return;
    }
    this.isComplete = true;
    try {
      updateJobFields(logger, job, { status: 'successful' });
      await job.save(db);
      logger.info('Completed service request successfully');
    } catch (e) {
      logger.error('Error marking request complete');
      logger.error(e);
      this.isComplete = false;
      this._fail(logger, job, 'Error finalizing service request');
      return;
    }
    this._completionCallbacks.resolve(true);
  }

  /**
   * Marks the service call as having failed with the given message
   *
   * @param {Logger} logger The logger to use for details about this request
   * @param {Job} job The job containing all service invocations
   * @param {string} message The user-facing error message
   * @returns {Promise<void>}
   * @memberof AsynchronizerService
   */
  async _fail(logger: Logger, job: Job, message: string): Promise<void> {
    if (this.isComplete) {
      logger.warn('Received a failure call for a completed job');
      return;
    }
    this.isComplete = true;
    try {
      updateJobFields(logger, job, { error: message });
      await job.save(db);
      logger.info('Completed service request with error');
    } catch (e) {
      logger.error('Error marking request failed');
      logger.error(e);
    } finally {
      this._completionCallbacks.reject(message);
    }
  }

  /**
   * Returns a promise which resolves to true if the job succeeds or rejects
   * with the error message if the job fails.
   *
   * @returns {Promise<boolean>} Promise for the result of the service invocation
   * @memberof AsynchronizerService
   */
  async promiseCompletion(): Promise<boolean> {
    return this.completionPromise;
  }
}
