const { before, after, beforeEach, afterEach } = require('mocha');
const sinon = require('sinon');
const request = require('superagent');
const BaseService = require('../../app/models/services/base-service');
const services = require('../../app/models/services');
const logger = require('../../app/util/log');

/**
 * Service implementation used for stubbing invocations for tests
 *
 * @class StubService
 * @extends {BaseService}
 */
class StubService extends BaseService {
  /**
   * Creates an instance of StubService.
   *
   * @param {DataOperation} operation The data operation being requested of the service
   * @param {object} callbackOptions The request options to be used for the callback (merged with
   *   request method and URL)
   * @memberof StubService
   */
  constructor(operation, callbackOptions) {
    super({}, operation, logger, 'http://example.com/dummy');
    this.callbackOptions = callbackOptions;
    this.isComplete = false;
    this.isRun = false;
    this.logger = logger;
  }

  /**
   * Runs the service.  For synchronous services, this will callback immediately.  For async,
   * `complete` must be run for a callback to occur.
   *
   * @memberof StubService
   * @returns {void}
   */
  async _run() {
    this.isRun = true;
    if (!this.operation.isSynchronous) return;
    await this.complete();
  }

  /**
   * Asynchronously POSTs to the operation's callback using the callback options provided to the
   * constructor
   *
   * @returns {void}
   * @memberof StubService
   */
  async complete() {
    // Allow tests / helpers to not care if a request is sync or async and always call `complete`
    // by only executing this if something has tried to run the service and has not called back yet.
    if (!this.isRun || this.isComplete) return;
    this.isComplete = true;
    await this.sendResponse(this.callbackOptions.params);
  }

  /**
   * Asynchronously POSTs a response to the backend using the supplied
   * query parameters but not marking the service complete.
   *
   * @param {object} query an object to be serialized as query params to the callback
   * @returns {void}
   * @memberof StubService
   */
  sendResponse(query) {
    const responseUrl = `${this.operation.callback}/response`;
    const { body, headers } = this.callbackOptions;
    let req = request.post(responseUrl);
    if (headers) {
      req = req.set(headers);
    }
    if (query) {
      req = req.query(query);
    }
    if (body) {
      req = req.send(body);
    }
    return req;
  }

  /**
   * Returns a function that can be passed to a before / beforeEach call to route
   * service requests to StubService
   *
   * @static
   * @param {object} callbackOptions The options to be used for the callback (merged with
   *   request method and URL)
   * @returns {Function} A function to supply to before / beforeEach
   * @memberof StubService
   */
  static beforeHook(callbackOptions = { params: { redirect: 'http://example.com' } }) {
    return function () {
      const ctx = this;
      sinon.stub(services, 'forOperation')
        .callsFake((req) => {
          ctx.service = new StubService(req.operation, callbackOptions);
          return ctx.service;
        });
    };
  }

  /**
   * Returns a function for tearing down hooks created by beforeHook
   *
   * @static
   * @returns {Function} A function to supply to after / afterEach
   * @memberof StubService
   */
  static afterHook() {
    return async function () {
      if (services.forOperation.restore) services.forOperation.restore();
      if (this.service) await this.service.complete();
      if (this.service && this.service.invocation) await this.service.invocation;
      delete this.service;
    };
  }

  /**
   * Adds before / after hooks in mocha to inject an instance of StubService
   * into service invocations within the current context.  Sets context.service
   * to the most recently created stub service.
   *
   * @static
   * @param {object} callbackOptions The options to be used for the callback (merged with
   *   request method and URL)
   * @returns {void}
   * @memberof StubService
   */
  static hook(callbackOptions = { params: { redirect: 'http://example.com' } }) {
    before(StubService.beforeHook(callbackOptions));
    after(StubService.afterHook());
  }

  /**
   * Adds beforeEach / afterEach hooks in mocha to inject an instance of StubService
   * into service invocations within the current context.  Sets context.service
   * to the most recently created stub service.
   *
   * @static
   * @param {object} callbackOptions The options to be used for the callback (merged with
   *   request method and URL)
   * @returns {void}
   * @memberof StubService
   */
  static hookEach(callbackOptions = { params: { redirect: 'http://example.com' } }) {
    beforeEach(StubService.beforeHook(callbackOptions));
    afterEach(StubService.afterHook());
  }

  /**
   * Adds before / after hooks in mocha to inject an instance of StubService
   * into service invocations within the current context. Makes the real service call
   * after replacing the docker image that would have been used with the passed in
   * docker image name.
   *
   * @static
   * @param {string} dockerImage The docker image name to use when calling the service.
   * @returns {void}
   * @memberof StubService
   */
  static hookDockerImage(dockerImage) {
    before(function () {
      // Tests using a docker image can take more than 2 seconds to start the docker container
      this.timeout(10000);
      const origForOperation = services.forOperation;
      sinon.stub(services, 'forOperation')
        .callsFake((req) => {
          const service = origForOperation(req);
          service.params.image = dockerImage;
          return service;
        });
    });
    after(function () {
      if (services.forOperation.restore) services.forOperation.restore();
    });
  }
}

module.exports = StubService;
