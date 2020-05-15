import _ from 'lodash';
import * as serviceResponse from 'backends/service-response';
import { defaultObjectStore } from 'util/object-store';
import { ServerError, RequestValidationError } from 'util/errors';
import { Job, JobStatus } from 'models/job';
import { v4 as uuid } from 'uuid';
import DataOperation from 'models/data-operation';
import { Logger } from 'winston';
import InvocationResult from './invocation-result';
import db from '../../util/db';

import env = require('util/env');

export interface ServiceCapabilities {
  subsetting?: {
    bbox?: boolean;
    variable?: boolean;
    multiple_variable?: true;
  };
  output_formats?: [string];
  projection_to_proj4?: boolean;
}

export interface ServiceConfig<ServiceParamType> {
  name?: string;
  data_operation_version?: string;
  type?: {
    name: string;
    params?: ServiceParamType;
    synchronous_only?: boolean;
  };
  collections?: string[];
  capabilities?: ServiceCapabilities;
  concurrency?: number;
  message?: string;
}

export interface CallbackQueryItem {
  type: string; // Mime type
  temporal: string;
  bbox: string;
  href: string;
}

export interface CallbackQuery {
  item?: CallbackQueryItem;
  error?: string;
  redirect?: string;
}

/**
 * Abstract base class for services.  Provides a basic interface and handling of backend response
 * callback plumbing.
 *
 * @class BaseService
 * @abstract
 */
export default class BaseService<ServiceParamType> {
  config: ServiceConfig<ServiceParamType>;

  params: ServiceParamType;

  operation: DataOperation;

  invocation: Promise<boolean>;

  resolveInvocation: (value?: unknown) => void;

  message?: string;

  /**
   * Creates an instance of BaseService.
   * @param {object} config The service configuration from config/services.yml
   * @param {DataOperation} operation The data operation being requested of the service
   * @memberof BaseService
   */
  constructor(config: ServiceConfig<ServiceParamType>, operation: DataOperation) {
    if (new.target === BaseService) {
      throw new TypeError('BaseService is abstract and cannot be instantiated directly');
    }
    this.config = config;
    const { type } = this.config;
    this.params = (type && type.params) ? type.params : ({} as ServiceParamType);
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
    const isAsync = !this.isSynchronous;
    const job = await this._createJob(logger, requestUrl, this.operation.stagingLocation);
    if (isAsync) {
      // All jobs are tracked internally.  Only async jobs are saved to the db
      try {
        await job.save(db);
      } catch (e) {
        logger.error(e.stack);
        throw new ServerError('Failed to save job to database.');
      }
    }
    // Promise that can be awaited to ensure the service has completed its work
    this.invocation = new Promise((resolve) => {
      this.resolveInvocation = resolve;
    });
    return new Promise((resolve, reject) => {
      const handleError = (e): void => {
        serviceResponse.unbindResponseUrl(this.operation.callback);
        reject(e);
      };
      try {
        if (isAsync) {
          this.operation.callback = serviceResponse.bindResponseUrl((req, res) => {
            // Async requests will re-query job records and not close on them to help
            // decouple response handling from the process that created the job.
            // Eventually, we'll want it to be the case that any Harmony process can
            // handle callbacks for any async job.
            this._processAsyncCallback(req, res, logger);
          });
        } else {
          this.operation.callback = serviceResponse.bindResponseUrl((req, res) => {
            // Sync callbacks need to be handled by the Harmony process that invoked them
            // because they are holding the original request open.
            this._processSyncCallback(req, res, job, logger)
              .then((result) => { if (result) resolve(result); });
          });
        }
        this._run(logger)
          .then((result) => {
            if (result) {
              // If running produces a result, use that rather than waiting for a callback
              serviceResponse.unbindResponseUrl(this.operation.callback);
              resolve(result);
              this.resolveInvocation(true);
            } else if (isAsync) {
              resolve({ redirect: `/jobs/${job.requestId}`, headers: {} });
            }
          })
          .catch(handleError);
      } catch (e) {
        handleError(e);
      }
    });
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
  protected async _run(_logger: Logger): Promise<InvocationResult> {
    throw new TypeError('BaseService subclasses must implement #_run()');
  }

  /**
   * Processes a callback coming from a synchronous service request
   *
   * @param {http.IncomingMessage} req the incoming callback request
   * @param {http.ServerResponse} res the outgoing callback response
   * @param {Job} job the synchronous job being performed
   * @param {Logger} logger The logger associated with this request
   * @returns {Promise<InvocationResult>}
   * @memberof BaseService
   */
  protected async _processSyncCallback(req, res, job: Job, logger): Promise<InvocationResult> {
    let result = null;

    const respondToService = (err): void => {
      if (err) {
        res.status(err.code || 500);
        res.send({ code: err.code, message: err.message });
      } else {
        res.status(200);
        res.send('Ok');
      }
    };

    try {
      if (_.isEmpty(req.query)) {
        result = { stream: req, onComplete: respondToService, headers: req.headers };
      } else {
        this._updateJobFields(logger, job, req.query);

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
        respondToService(null);
      }
    } catch (e) {
      logger.error(e);
      respondToService(e);
      result = { error: 'The service request failed due to an internal error', statusCode: 500 };
    } finally {
      if (result) {
        serviceResponse.unbindResponseUrl(this.operation.callback);
        if (this.resolveInvocation) this.resolveInvocation(true);
      }
    }

    return result;
  }

  /**
   * Processes a callback coming from an asynchronous service request (Job)
   *
   * @param {http.IncomingMessage} req the incoming callback request
   * @param {http.ServerResponse} res the outgoing callback response
   * @param {Logger} logger The logger associated with this request
   * @returns {void}
   * @memberof BaseService
   */
  protected async _processAsyncCallback(req, res, logger: Logger): Promise<void> {
    const trx = await db.transaction();

    const { user, requestId } = this.operation;
    const job = await Job.byUsernameAndRequestId(trx, user, requestId);
    if (!job) {
      trx.rollback();
      res.status(404);
      logger.error(`Received a callback for a missing job: user=${user}, requestId=${requestId}`);
      res.json({ code: 404, message: 'could not find a job with the given ID' });
      return;
    }

    try {
      await this._updateJobFields(logger, job, req.query);
      await job.save(trx);
      await trx.commit();
      res.status(200);
      res.send('Ok');
    } catch (e) {
      await trx.rollback();
      const status = e.code || (e instanceof TypeError ? 400 : 500);
      res.status(status);
      res.json({ code: status, message: e.message });
    } finally {
      if (job.isComplete()) {
        if (this.resolveInvocation) this.resolveInvocation(true);
        serviceResponse.unbindResponseUrl(this.operation.callback);
        const durationMs = +job.updatedAt - +job.createdAt;
        const numOutputs = job.getRelatedLinks('data').length;
        logger.info('Async job complete.', { durationMs, numOutputs, job: job.serialize() });
      }
    }
  }

  /**
   * Helper for updating a job, given a query string provided in a callback
   *
   * Note: parameter reassignment is allowed, since it's the purpose of this function.
   *
   * @param {Logger} logger The logger associated with this request
   * @param {Job} job The job record to update
   * @param {object} query The parsed query coming from a service callback
   * @returns {void}
   * @throws {RequestValidationError} If the callback parameters fail validation
   * @throws {ServerError} If job update fails unexpectedly
   * @memberof BaseService
   */
  protected async _updateJobFields(
    logger,
    job,
    query,
  ): Promise<void> { /* eslint-disable no-param-reassign */
    const { error, item, status, redirect, progress } = query;
    try {
      if (item) {
        if (item.bbox) {
          const bbox = item.bbox.split(',').map(parseFloat);
          if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
            throw new TypeError('Unrecognized bounding box format.  Must be 4 comma-separated floats as West,South,East,North');
          }
          item.bbox = bbox;
        }
        if (item.temporal) {
          const temporal = item.temporal.split(',').map((t) => Date.parse(t));
          if (temporal.length !== 2 || temporal.some(Number.isNaN)) {
            throw new TypeError('Unrecognized temporal format.  Must be 2 RFC-3339 dates with optional fractional seconds as Start,End');
          }
          const [start, end] = temporal.map((t) => new Date(t).toISOString());
          item.temporal = { start, end };
        }
        item.rel = item.rel || 'data';
        job.addLink(item);
      }
      if (progress) {
        if (Number.isNaN(+progress)) {
          throw new TypeError('Job record is invalid: ["Job progress must be between 0 and 100"]');
        }
        job.progress = parseInt(progress, 10);
      }

      if (error) {
        job.fail(error);
      } else if (status) {
        job.updateStatus(status);
      } else if (redirect) {
        job.addLink({ href: redirect, rel: 'data' });
        job.succeed();
      }
    } catch (e) {
      const ErrorClass = (e instanceof TypeError) ? RequestValidationError : ServerError;
      logger.error(e);
      throw new ErrorClass(e.message);
    }
  }

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
    });
    job.addStagingBucketLink(stagingLocation);
    if (this.warningMessage) {
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

    const maxSyncGranules = _.get(this.config, 'maximum_sync_granules', env.maxSynchronousGranules);
    return this.operation.cmrHits <= maxSyncGranules;
  }

  /**
   * Returns a warning message if some part of the request can't be fulfilled
   *
   * @returns {string} a warning message to display, or undefined if not applicable
   * @readonly
   * @memberof BaseService
   */
  get warningMessage(): string {
    if (this.operation.cmrHits > env.maxAsynchronousGranules) {
      return `CMR query identified ${this.operation.cmrHits} granules, but the request has been limited `
      + `to process only the first ${env.maxAsynchronousGranules} granules.`;
    }
    return undefined;
  }
}
