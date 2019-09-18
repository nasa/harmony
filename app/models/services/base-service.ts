const serviceResponse = require('../../backends/service-response');

class BaseService {
  constructor(config, operation) {
    if (new.target === BaseService) {
      throw new TypeError('BaseService is abstract and cannot be instantiated directly');
    }
    this.config = config;
    this.params = this.config.type.params;
    this.operation = operation;
  }

  get capabilities() {
    return this.config.capabilities;
  }

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

  _invokeAsync() {
    throw new TypeError('BaseService subclasses must implement #_invokeAsync()');
  }
}

module.exports = BaseService;
