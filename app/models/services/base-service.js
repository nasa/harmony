const serviceResponse = require('../../backends/service-response');
const db = require('../../util/db');
const Job = require('../../models/job');
const { ServerError } = require('../../util/errors');

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
   *
   * @param {object} config The service configuration from config/services.yml
   * @param {DataOperation} operation The data operation being requested of the service
   * @param {Logger} logger The logger associated with this request
   * @memberof BaseService
   */
  constructor(config, operation, logger) {
    if (new.target === BaseService) {
      throw new TypeError('BaseService is abstract and cannot be instantiated directly');
    }
    this.config = config;
    const { type } = this.config;
    this.params = (type && type.params) ? type.params : {};
    this.operation = operation;
    this.logger = logger;
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
  async invoke() {
    const isAsync = !this.operation.isSynchronous;
    let job;
    if (isAsync) {
      job = await this._createJob(db);
    }
    // Promise that can be awaited to ensure the service has completed its work
    this.invocation = new Promise((resolve) => {
      this.resolveInvocation = resolve;
    });
    return new Promise((resolve, reject) => {
      try {
        this.operation.callback = serviceResponse.bindResponseUrl((req, res) => {
          if (isAsync) {
            this._processAsyncCallback(req, res);
          } else {
            resolve(this._processSyncCallback(req, res));
          }
        });
        this._run();
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
   *
   * @memberof BaseService
   * @returns {void}
   */
  _run() {
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
   * @returns {void}
   * @memberof BaseService
   */
  async _processAsyncCallback(req, res) {
    const { error, item, status, redirect } = req.query;
    const trx = await db.transaction();
    let err = null;

    try {
      const { user, requestId } = this.operation;
      const job = await Job.byUsernameAndRequestId(trx, user, requestId);
      if (!job) {
        res.status(404);
        res.json({ code: 404, message: 'could not find a job with the given ID' });
        trx.rollback();
        return;
      }

      if (item) {
        job.links.push(item);
      }

      if (error) {
        job.status = 'failed';
        job.message = error;
      } else if (status) {
        job.status = status;
      } else if (redirect) {
        job.links.push({ href: redirect });
        job.status = 'successful';
      }
      await job.save(trx);
      await trx.commit();
    } catch (e) {
      this.logger.error(e);
      err = { code: 500, message: e.message };
      await trx.rollback();
    } finally {
      if (error || status === 'successful' || status === 'failed') {
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
   * @returns {Job} The created job
   * @memberof BaseService
   * @throws {ServerError} if the job cannot be created
   */
  async _createJob(transaction) {
    const { requestId, user } = this.operation;
    this.logger.info(`Creating job for ${requestId}`);
    const job = new Job({ username: user, requestId, status: 'running' });
    if (this.truncationMessage) {
      job.message = this.truncationMessage;
    }
    try {
      await job.save(transaction);
    } catch (e) {
      this.logger.error(e.stack);
      throw new ServerError('Failed to save job to database.');
    }
    return job;
  }
}

module.exports = BaseService;
