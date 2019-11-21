// Use stdlib HTTP instead of axios because we need lower-level control over headers, streaming
// and redirects than axios wants to provide
const http = require('http');
const https = require('https');
const BaseService = require('./base-service');

/**
 * Service implementation which chains other service implementations with one
 * another when invoked
 *
 * @class HttpService
 * @extends {BaseService}
 */
class HttpService extends BaseService {
  /**
   * Calls the HTTP backend and returns a promise for its result
   *
   * @returns {Promise<{req: http.IncomingMessage, res: http.ServerResponse}>} A promise resolving
   *     to the service callback req/res
   * @memberof BaseService
   */
  invoke() {
    return new Promise((resolve, reject) => {
      try {
        const body = this.operation.serialize();
        const { url } = this.params;
        const requestOptions = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        };
        const httplib = url.startsWith('https') ? https : http;

        const request = httplib.request(url, requestOptions, (res) => {
          const result = {
            headers: res.headers,
            statusCode: res.statusCode,
          };

          if (res.statusCode < 300) {
            result.stream = res;
            resolve(result);
          } else if (res.statusCode < 400) {
            result.redirect = res.headers.location;
            resolve(result);
          } else {
            result.error = '';
            res.on('data', (chunk) => { result.error += chunk; });
            res.on('end', () => { resolve(result); });
            res.on('error', (err) => {
              result.error = err.message;
              resolve(result);
            });
          }
        });
        // post the data
        request.write(body);
        request.end();
      } catch (e) {
        reject(e);
      }
    });
  }
}

module.exports = HttpService;
