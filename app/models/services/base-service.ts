const getIn = require('lodash.get');
const serviceResponse = require('../../backends/service-response');
const db = require('../../util/db');
const Job = require('../job');
const { ServerError } = require('../../util/errors');
const env = require('../../util/env');


/**
 * Abstract base class for services.  Provides a basic interface and handling of backend response
 * callback plumbing.
 *
 * @class BaseService
 * @abstract
 */
class BaseService {
  /**
   * Creates an instance of BaseService.
   * @param {object} config The service configuration from config/services.yml
   * @param {DataOperation} operation The data operation being requested of the service
   * @memberof BaseService
   */
  constructor(config, operation) {
    if (new.target === BaseService) {
      throw new TypeError('BaseService is abstract and cannot be instantiated directly');
    }
    this.config = config;
    const { type } = this.config;
    this.params = (type && type.params) ? type.params : {};
    this.operation = operation;
    this.operation.isSynchronous = this.isSynchronous;
    // To be fixed by HARMONY-203 to not default to TIFF
    // this.operation.outputFormat = this.operation.outputFormat;
  }

  /**
   * Returns the capabilities as specified in config/services.yml
   *
   * @readonly
   * @memberof BaseService
   * @returns {object} The service capabilities
   */
  get capabilities() {
    return this.config.capabilities;
  }

  /**
   * Invokes the service, returning a promise for the invocation result with the
   * following properties:
   *
   * error: An error message.  If set, the invocation was an error and the provided
   *   message should be sent to the client
   * errorCode: (optional) An HTTP status code for the error.  If set and there is an
   *   error, the HTTP status code will be set to this value
   * redirect: A redirect URL.  If set, the client should be redirected
   *   to this URL
   * stream: A byte stream.  If set, the bytes in the stream should be piped to the client
   * headers: An object mapping key/value headers.  Any headers starting with "harmony" should
   *   be passed to the client.  When streaming a result, content-type and content-length
   *   should also be set.
   * onComplete: (optional) A callback function with no arguments to be invoked when the
   *   client receives its response
   * @param {Logger} logger The logger associated with this request
   * @param {String} harmonyRoot The harmony request root
   * @param {String} requestUrl The URL the end user invoked
   *
   * @returns {Promise<{
   *     error: string,
   *     errorCode: number,
   *     redirect: string,
   *     stream: Stream,
   *     headers: object,
   *     onComplete: Function
   *   }>} A promise resolving to the result of the callback. See method description
   * for properties
   * @memberof BaseService
   */
  async invoke(logger, harmonyRoot, requestUrl) {
    const isAsync = !this.isSynchronous;
    let job;
    if (isAsync) {
      job = await this._createJob(db, logger, requestUrl);
    }
    // Promise that can be awaited to ensure the service has completed its work
    this.invocation = new Promise((resolve) => {
      this.resolveInvocation = resolve;
    });
    return new Promise((resolve, reject) => {
      try {
        // eslint-disable-next-line no-param-reassign
        this.operation.callback = serviceResponse.bindResponseUrl((req, res) => {
          if (isAsync) {
            this._processAsyncCallback(req, res, logger);
          } else {
            resolve(this._processSyncCallback(req, res));
          }
        });
        this._run(logger);
        if (isAsync) {
          resolve({ redirect: `/jobs/${job.requestId}`, headers: {} });
        }
      } catch (e) {
        serviceResponse.unbindResponseUrl(this.operation.callback);
        reject(e);
      }
    });
  }

  /**
   * Abstract method used by invoke() to simplify implementation of async invocations.
   * Subclasses must implement this method if using the default invoke() implementation.
   * The method will be invoked asynchronously, completing when the service's callback is
   * received.
   * @param {Log} _logger the logger associated with the request
   * @memberof BaseService
   * @returns {void}
   */
  _run(_logger) {
    throw new TypeError('BaseService subclasses must implement #_run()');
  }

  /**
   * Processes a callback coming from a synchronous service request
   *
   * @param {http.IncomingMessage} req the incoming callback request
   * @param {http.ServerResponse} res the outgoing callback response
   * @returns {void}
   * @memberof BaseService
   */
  _processSyncCallback(req, res) {
    const { error, redirect } = req.query;
    let result;

    try {
      result = {
        headers: req.headers,
        onComplete: (err) => {
          if (err) {
            res.status(err.code);
            res.send(JSON.stringify(err));
          } else {
            res.status(200);
            res.send('Ok');
          }
        },
      };

      if (error) {
        result.error = error;
      } else if (redirect) {
        result.redirect = redirect;
      } else {
        result.stream = req;
      }
    } finally {
      serviceResponse.unbindResponseUrl(this.operation.callback);
      if (this.resolveInvocation) this.resolveInvocation(true);
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
  async _processAsyncCallback(req, res, logger) {
    const { error, item, status, redirect, progress } = req.query;
    const trx = await db.transaction();
    let err = null;

    let job;
    try {
      const { user, requestId } = this.operation;
      job = await Job.byUsernameAndRequestId(trx, user, requestId);
      if (!job) {
        res.status(404);
        logger.error(`Received a callback for a missing job: user=${user}, requestId=${requestId}`);
        res.json({ code: 404, message: 'could not find a job with the given ID' });
        trx.rollback();
        return;
      }

      if (item) {
        job.links.push(item);
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
        job.addLink({ href: redirect });
        job.succeed();
      }
      await job.save(trx);
      await trx.commit();
    } catch (e) {
      const code = (e instanceof TypeError) ? 400 : 500;
      logger.error(e);
      err = { code, message: e.message };
      await trx.rollback();
    } finally {
      if (error || !job || job.isComplete()) {
        if (this.resolveInvocation) this.resolveInvocation(true);
        serviceResponse.unbindResponseUrl(this.operation.callback);
      }
    }
    if (err) {
      res.status(err.code);
      res.json(err);
    } else {
      res.status(200);
      res.send('Ok');
    }
  }

  /**
   * Creates a new job for this service's operation, with appropriate logging, errors,
   * and warnings.
   *
   * @param {knex.Transaction} transaction The transaction to use when creating the job
   * @param {Logger} logger The logger associated with this request
   * @param {String} requestUrl The URL the end user invoked
   * @returns {Job} The created job
   * @memberof BaseService
   * @throws {ServerError} if the job cannot be created
   */
  async _createJob(transaction, logger, requestUrl) {
    const { requestId, user } = this.operation;
    logger.info(`Creating job for ${requestId}`);
    const job = new Job({ username: user, requestId, status: 'running', request: requestUrl });
    if (this.warningMessage) {
      job.message = this.warningMessage;
    }
    try {
      await job.save(transaction);
    } catch (e) {
      logger.error(e.stack);
      throw new ServerError('Failed to save job to database.');
    }
    return job;
  }

  /**
   * Returns true if a request should be handled synchronously, false otherwise
   *
   * @returns {boolean} true if the request is synchronous, false otherwise
   *
   */
  get isSynchronous() {
    const { operation } = this;

    if (operation.requireSynchronous) {
      return true;
    }
    if (operation.isSynchronous !== undefined) {
      return operation.isSynchronous;
    }

    const maxSyncGranules = getIn(this.config, 'maximum_sync_granules', env.maxSynchronousGranules);
    return this.operation.cmrHits <= maxSyncGranules;
  }

  /**
   * Returns a warning message if some part of the request can't be fulfilled
   *
   * @returns {string} a warning message to display, or undefined if not applicable
   * @readonly
   * @memberof BaseService
   */
  get warningMessage() {
    if (this.operation.cmrHits > env.maxAsynchronousGranules) {
      return `CMR query identified ${this.operation.cmrHits} granules, but the request has been limited `
      + `to process only the first ${env.maxAsynchronousGranules} granules.`;
    }
    return undefined;
  }
}

module.exports = BaseService;
