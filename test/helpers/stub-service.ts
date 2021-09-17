/* eslint-disable @typescript-eslint/no-this-alias */
import { before, after, beforeEach, afterEach } from 'mocha';
import sinon, { SinonStub } from 'sinon';
import request from 'superagent';
import { Logger } from 'winston';
import { CallbackQuery } from '../../app/backends/service-response';
import BaseService, { ServiceConfig } from '../../app/models/services/base-service';
import * as services from '../../app/models/services/index';
import DataOperation from '../../app/models/data-operation';
import InvocationResult from '../../app/models/services/invocation-result';

/**
 * Service implementation used for stubbing invocations for tests
 *
 */
export default class StubService extends BaseService<void> {
  callbackOptions: object | Function;

  isComplete: boolean;

  isRun: boolean;

  name: string;

  /**
   * Creates an instance of StubService.
   *
   * @param callbackOptions - The request options to be used for the callback, with
   *   keys for params (query parameter object), headers (headers to set), and body (body to POST).
   *   If a function is passed instead of an object, it will be called with no arguments to a
   *   callback options object.
   * @param operation - The data operation being requested of the service
   * @param serviceName - The service name
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
   * @param _logger - the logger associated with the request
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
   */
  async complete(): Promise<void> {
    // Allow tests / helpers to not care if a request is sync or async and always call `complete`
    // by only executing this if something has tried to run the service and has not called back yet.
    if (!this.isRun || this.isComplete) return;
    this.isComplete = true;
    await this.sendResponse({ argo: 'true' });
  }

  /**
   * Asynchronously POSTs a response to the backend using the supplied
   * query parameters but not marking the service complete.
   *
   * @param query - an object to be serialized as query params to the callback, defaults to
   *   the callback options parameters
   * @returns an awaitable response
   */
  sendResponse(query?: CallbackQuery): request.SuperAgentRequest {
    const options = typeof this.callbackOptions === 'function' ? this.callbackOptions() : this.callbackOptions;
    const argo = query?.argo;
    let params = query;
    if (argo || !query) {
      // eslint-disable-next-line prefer-destructuring
      params = options.params;
    }
    const responseUrl = `${this.operation.callback}/response`;
    const { body, headers } = options;
    let req = request.post(responseUrl);
    if (headers) {
      req = req.set(headers);
    }
    if (params) {
      if (argo) {
        params.argo = 'true';
      }
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
   * @param callbackOptions - The options to be used for the callback (merged with
   *   request method and URL)
   * @returns A function to supply to before / beforeEach
   */
  static beforeHook(callbackOptions: object = { params: { redirect: 'http://example.com' } }): () => void {
    return function (): void {
      const ctx = this;
      sinon.stub(services, 'buildService')
        .callsFake((config, operation) => {
          ctx.service = new StubService(callbackOptions, operation, config.name);
          return ctx.service;
        });
    };
  }

  /**
   * Returns a function for tearing down hooks created by beforeHook
   *
   * @returns A function to supply to after / afterEach
   */
  static afterHook(): () => Promise<void> {
    return async function (): Promise<void> {
      const stubbed = services.buildService as SinonStub;
      if (stubbed.restore) stubbed.restore();
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
   * @param callbackOptions - The options to be used for the callback (merged with
   *   request method and URL)
   */
  static hook(callbackOptions: object | Function = { params: { redirect: 'http://example.com' } }): void {
    before(StubService.beforeHook(callbackOptions));
    after(StubService.afterHook());
  }

  /**
   * Adds beforeEach / afterEach hooks in mocha to inject an instance of StubService
   * into service invocations within the current context.  Sets context.service
   * to the most recently created stub service.
   *
   * @param callbackOptions - The options to be used for the callback (merged with
   *   request method and URL)
   */
  static hookEach(callbackOptions: object = { params: { redirect: 'http://example.com' } }): void {
    beforeEach(StubService.beforeHook(callbackOptions));
    afterEach(StubService.afterHook());
  }
}

/**
 * Adds before and after hooks to stub the services in the system
 */
export function hookServices(serviceConfigs: ServiceConfig<unknown>[]): void {
  let stubService;

  before(function () {
    stubService = sinon.stub(services, 'getServiceConfigs')
      .returns(serviceConfigs);
  });

  after(function () {
    stubService.restore();
  });
}
