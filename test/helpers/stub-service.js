const { before, after, beforeEach, afterEach } = require('mocha');
const sinon = require('sinon');
const request = require('superagent');
const BaseService = require('../../app/models/services/base-service');
const services = require('../../app/models/services');

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
    super({}, operation);
    this.callbackOptions = callbackOptions;
  }

  /**
   * Asynchronously POSTs to the operation's callback using the callback options provided to the
   * constructor set by the constructor
   *
   * @memberof StubService
   * @returns {void}
   */
  async _invokeAsync() {
    const responseUrl = `${this.operation.callback}/response`;
    const { params, body, headers } = this.callbackOptions;
    let req = request.post(responseUrl);
    if (headers) {
      req = req.set(headers);
    }
    if (params) {
      req = req.query(params);
    }
    if (body) {
      req = req.send(body);
    }
    await req;
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
      sinon.stub(services, 'forName')
        .callsFake((name, operation) => {
          ctx.service = new StubService(operation, callbackOptions);
          return ctx.service;
        });
      sinon.stub(services, 'forOperation')
        .callsFake((operation) => {
          ctx.service = new StubService(operation, callbackOptions);
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
    return function () {
      if (services.forName.restore) services.forName.restore();
      if (services.forOperation.restore) services.forOperation.restore();
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
}

module.exports = StubService;
