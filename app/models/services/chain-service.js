const path = require('path');
const set = require('lodash.set');
const BaseService = require('./base-service');
const services = require('../services');

class ChainService extends BaseService {
  async invoke() {
    let result;
    for (const serviceInfo of this.params.services) {
      const service = services.forName(serviceInfo.name, this.operation);
      result = await service.invoke();
      const { query } = result.req;
      if (query.error) {
        // Propagate errors that come from services early in the chain
        return result;
      }
      if (query.redirect) {
        this.operation.sources = [this.operation.sources[0]];
        this.operation.sources[0].granules = [{
          id: 'Harmony-0',
          name: path.basename(query.redirect),
          url: query.redirect,
        }];
        const { updates } = serviceInfo;
        if (updates) {
          for (const update of Object.keys(updates)) {
            set(this.operation.model, update, updates[update]);
          }
        }
        // Hard-coded for now, HARMONY-11 specifies this as acceptable
        this.operation.model.subset = {};
        delete this.operation.model.format.crs;
        console.log(JSON.stringify(this.operation.model, null, 2));
      } else {
        throw new Error('Unsupported service response');
      }
    }
    return result;
    /*
    this.config = config;
    this.params = this.config.type.params;
    this.operation = operation;
    */
  }
}

module.exports = ChainService;
