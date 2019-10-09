const serviceResponse = require('../../backends/service-response');

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
   * Invokes the service, returning a promise for the invocation result
   *
   * @returns {Promise<{req: http.IncomingMessage, res: http.ServerResponse}>} A promise resolving
   *     to the service callback req/res
   * @memberof BaseService
   */
  invoke() {
    return new Promise((resolve, reject) => {
      try {
        this.operation.callback = serviceResponse.bindResponseUrl((req, res) => {
          resolve({ req, res });
        });
        this._invokeAsync();
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
  _invokeAsync() {
    throw new TypeError('BaseService subclasses must implement #_invokeAsync()');
  }
}

module.exports = BaseService;
