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
   * Invokes the service, returning a promise for the invocation result with the
   * following properties:
   *
   * error: An error message.  If set, the invocation was an error on the
   *   message should go to the client
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
  invoke() {
    return new Promise((resolve, reject) => {
      try {
        this.operation.callback = serviceResponse.bindResponseUrl((req, res) => {
          const { error, redirect } = req.query;

          const result = {
            headers: req.headers,
            onComplete: () => {
              res.status(200);
              res.send('Ok');
            },
          };

          if (error) {
            result.error = error;
          } else if (redirect) {
            result.redirect = redirect;
          } else {
            result.stream = req;
          }

          resolve(result);
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
