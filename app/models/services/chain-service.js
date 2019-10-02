const path = require('path');
const set = require('lodash.set');
const BaseService = require('./base-service');
const services = require('../services');

/**
 * Service implementation which chains other service implementations with one
 * another when invoked
 *
 * @class ChainService
 * @extends {BaseService}
 */
class ChainService extends BaseService {
  /**
   * Asynchronously invokes the service chain, as discovered / constructed by ./index.js from
   * services.yml.  If successful, returns the last invocation result.  Stops the chain on the
   * first error and returns the erroneous invocation result if unsuccessful.
   *
   * @returns {Promise<{req: http.IncomingMessage, res: http.ServerResponse}>} The invocation
   *   result of the last service in the chain or that of the first error, if an error occurs
   * @memberof ChainService
   */
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
      } else {
        throw new Error('Unsupported service response');
      }
    }
    return result;
  }
}

module.exports = ChainService;
