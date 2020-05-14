/* eslint-disable @typescript-eslint/no-this-alias */
import { before, after, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import request from 'superagent';
import AsynchronizerService from 'models/services/asynchronizer-service';
import BaseService from 'models/services/base-service';
import * as services from 'models/services/index';
import { Logger } from 'winston';
import DataOperation from 'harmony/models/data-operation';
import InvocationResult from 'models/services/invocation-result';
import LocalDockerService from 'harmony/models/services/local-docker-service';

/**
 * Service implementation used for stubbing invocations for tests
 *
 * @class StubService
 * @extends {BaseService}
 */
export default class StubService extends BaseService<void> {
  callbackOptions: any;

  isComplete: boolean;

  isRun: boolean;

  name: any;

  /**
   * Creates an instance of StubService.
   *
   * @param {Object|Function} callbackOptions The request options to be used for the callback, with
   *   keys for params (query parameter object), headers (headers to set), and body (body to POST).
   *   If a function is passed instead of an object, it will be called with no arguments to a
   *   callback options object.
   * @param {DataOperation} operation The data operation being requested of the service
   * @param {String} serviceName The service name
   * @memberof StubService
   */
  constructor(callbackOptions: object | Function, operation: DataOperation, serviceName: string) {
    super({ name: 'harmony/stub' }, operation);
    this.callbackOptions = callbackOptions;
    this.isComplete = false;
    this.isRun = false;
    this.name = serviceName;
  }

  /**
   * Runs the service.  For synchronous services, this will callback immediately.  For async,
   * `complete` must be run for a callback to occur.
   * @param {Logger} _logger the logger associated with the request
   * @memberof StubService
   * @returns {Promise<InvocationResult>}
   */
  async _run(_logger: Logger): Promise<InvocationResult> {
    this.isRun = true;
    if (!this.operation.isSynchronous) return null;
    await this.complete();
    return null;
  }

  /**
   * Asynchronously POSTs to the operation's callback using the callback options provided to the
   * constructor
   *
   * @returns {void}
   * @memberof StubService
   */
  async complete(): Promise<void> {
    // Allow tests / helpers to not care if a request is sync or async and always call `complete`
    // by only executing this if something has tried to run the service and has not called back yet.
    if (!this.isRun || this.isComplete) return;
    this.isComplete = true;
    await this.sendResponse();
  }

  /**
   * Asynchronously POSTs a response to the backend using the supplied
   * query parameters but not marking the service complete.
   *
   * @param {object} query an object to be serialized as query params to the callback, defaults to
   *   the callback options parameters
   * @returns {request} an awaitable response
   * @memberof StubService
   */
  sendResponse(query?: object): any {
    const options = typeof this.callbackOptions === 'function' ? this.callbackOptions() : this.callbackOptions;
    const params = query || options.params;
    const responseUrl = `${this.operation.callback}/response`;
    const { body, headers } = options;
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
  static beforeHook(callbackOptions: object = { params: { redirect: 'http://example.com' } }): any {
    return function (): any {
      const ctx = this;
      const origForOperation = services.forOperation;
      sinon.stub(services, 'forOperation')
        .callsFake((operation, context, configs) => {
          const chosenService = origForOperation(operation, context, configs);
          // Notes from testing HARMONY-273: This stub has been partly relying on mutations
          // happening in origForOperation and after to set up content type, isSynchronous,
          // stagingLocation, and probably others.  Setting stagingLocation is undesirable as
          // behavior has changed to not overwrite stagingLocation if it's already set in the
          // operation, so we reset it after the above call.
          operation.stagingLocation = null; // eslint-disable-line no-param-reassign
          ctx.service = new StubService(callbackOptions, operation, chosenService.config.name);
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
  static afterHook(): any {
    return async function (): Promise<any> {
      if ((services.forOperation as any).restore) (services.forOperation as any).restore();
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
  static hook(callbackOptions: any = { params: { redirect: 'http://example.com' } }): void {
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
  static hookEach(callbackOptions: object = { params: { redirect: 'http://example.com' } }): void {
    beforeEach(StubService.beforeHook(callbackOptions));
    afterEach(StubService.afterHook());
  }

  /**
   * Sets up a synchronous StubService to be invoked by the AsynchronizerService.  Be careful
   * to ensure the Asynchronizer completes its work before ending the test
   *
   * @static
   * @param {object} callbackOptions The options to be used for _each_ callback
   * @returns {void}
   * @memberof StubService
   */
  static hookAsynchronized(callbackOptions: any = { params: { redirect: 'http://example.com' } }): void {
    before(async function () {
      const ctx = this;
      this.callbackOptions = callbackOptions;
      sinon.stub(services, 'forOperation')
        .callsFake((operation) => {
          ctx.service = new AsynchronizerService(StubService, callbackOptions, operation);
          return ctx.service;
        });
    });

    after(async function () {
      if ((services.forOperation as any).restore) (services.forOperation as any).restore();
      try {
        await this.service.promiseCompletion();
      } catch { /* Normal for expected errors. Logs captured by the AsynchronizerService */
      } finally {
        delete this.service;
        delete this.callbackOptions;
      }
    });
  }

  /**
   * Adds before hooks for asynchronized service completion
   *
   * @static
   * @param {boolean} [allowError=false] Whether a service error should fail the before hook
   * @returns {void}
   * @memberof StubService
   */
  static hookAsynchronizedServiceCompletion(allowError = false): void {
    before(async function () {
      try {
        await this.service.promiseCompletion();
      } catch (e) {
        if (!allowError) throw e;
      }
    });
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
  static hookDockerImage(dockerImage: string): void {
    before(function () {
      // Tests using a docker image can take more than 2 seconds to start the docker container
      this.timeout(10000);
      const origForOperation = services.forOperation;
      sinon.stub(services, 'forOperation')
        .callsFake((operation) => {
          const service = origForOperation(operation) as LocalDockerService;
          service.params.image = dockerImage;
          return service;
        });
    });
    after(function () {
      if ((services.forOperation as any).restore) (services.forOperation as any).restore();
    });
  }
}
