import PromiseQueue from 'p-queue';
import BaseService from 'models/services/base-service';
import { Job } from 'models/job';

import { ServiceError } from '../../util/errors';
import { objectStoreForProtocol } from '../../util/object-store';
import InvocationResult from './invocation-result';

import db = require('util/db');

/**
 * A wrapper for a service that takes a service class for a service that is only able
 * to handle synchronous requests and feeds it granules one-at-a-time, aggregating the
 * results, effectively making it asynchronous
 *
 * @class AsynchronizerService
 * @extends {BaseService}
 */
export default class AsynchronizerService extends BaseService {
  SyncServiceClass: typeof BaseService;

  queue: any;

  completionPromise: Promise<unknown>;

  completedCount: number;

  totalCount: number;

  private _completionCallbacks: {
    resolve: (value?: unknown) => void; reject: (reason?: any) => void;
  };

  _invokeArgs: any[];

  isComplete: boolean;

  constructor(SyncServiceClass: { new(...args): BaseService }, config: any, operation: any) {
    super(config, operation);
    this.SyncServiceClass = SyncServiceClass;
    this.queue = new PromiseQueue({ concurrency: this.config.concurrency || 1 });
    this.completionPromise = new Promise((resolve, reject) => {
      this._completionCallbacks = { resolve, reject };
    });
  }

  /**
   * Invokes the service, delegating directly for sync requests or converting to async for
   * async
   *
   * @param {Logger} logger The logger to use for details about this request
   * @param {String} harmonyRoot The harmony root URL
   * @param {string} requestUrl The request's URL to record in Job records
   * @returns {Promise<object>} A promise for the invocation result. @see BaseService#invoke
   * @memberof AsynchronizerService
   */
  async invoke(logger, harmonyRoot, requestUrl) {
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
  async _run(logger): Promise<InvocationResult> {
    const { user, requestId } = this.operation;
    const job = await Job.byUsernameAndRequestId(db, user, requestId);
    try {
      logger.info('Running asynchronously');
      const operations = this._getSyncOperations();
      this.isComplete = false;
      this.completedCount = 0;
      this.totalCount = operations.length;
      for (const { name, syncOperation } of operations) {
        await this.queue.add(() => this._invokeServiceSync(logger, job, name, syncOperation));
      }
      await this.queue.onIdle();
      await this._succeed(logger, job);
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
  _getSyncOperations() {
    const result = [];
    for (const source of this.operation.sources) {
      for (const granule of source.granules) {
        const op = this.operation.clone();
        op.isSynchronous = true;
        op.requireSynchronous = true;
        op.sources = [];
        op.addSource(source.collection, source.variables, [granule]);
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
  async _invokeServiceSync(logger, job, name, syncOperation) {
    logger.info(`Invoking service on ${name}`);
    const service = new this.SyncServiceClass(this.config, syncOperation);
    const result = await service.invoke(...this._invokeArgs);

    try {
      if (result.error) {
        throw new ServiceError(result.statusCode || 400, result.error);
      }

      const granule = syncOperation.sources[0].granules[0];
      const item: any = {
        type: 'application/octet-stream', // Generic default in case we can't find anything else
        temporal: granule.temporal && [granule.temporal.start, granule.temporal.end].join(','),
        bbox: granule.bbox && granule.bbox.join(','),
      };

      this.completedCount += 1;
      const progress = Math.round(this.completedCount / this.totalCount);

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

      await this._updateJobFields(logger, job, { item, progress });
      await job.save(db);
      logger.info(`Completed service on ${name}`);
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
   * @returns {void}
   * @memberof AsynchronizerService
   */
  async _succeed(logger, job) {
    if (this.isComplete) {
      logger.warn('Received a success call for a completed job');
      return;
    }
    this.isComplete = true;
    try {
      await this._updateJobFields(logger, job, { status: 'successful' });
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
   * @returns {void}
   * @memberof AsynchronizerService
   */
  async _fail(logger, job, message) {
    if (this.isComplete) {
      logger.warn('Received a failure call for a completed job');
      return;
    }
    this.isComplete = true;
    try {
      await this._updateJobFields(logger, job, { error: message });
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
  async promiseCompletion() {
    return this.completionPromise;
  }
}
