// Use stdlib HTTP instead of axios because we need lower-level control over headers, streaming
// and redirects than axios wants to provide
const http = require('http');
const https = require('https');
const URL = require('url');
const BaseService = require('./base-service');
const db = require('../../util/db');
const Job = require('../../models/job');

/**
 * Service implementation which invokes a backend over HTTP, synchronously POSTing the Harmony
 * message to its configured endpoint and conveying its response back to the caller.  This is
 * done in a single request to the backend.  We may poll for job status in the future.
 *
 * @class HttpService
 * @extends {BaseService}
 */
class HttpService extends BaseService {
  invoke() {
    if (this.operation.isSynchronous) {
      return this._run();
    }
    return super.invoke();
  }

  /**
   * Calls the HTTP backend and returns a promise for its result
   *
   * @returns {Promise<{req: http.IncomingMessage, res: http.ServerResponse}>} A promise resolving
   *     to the service callback req/res
   * @memberof BaseService
   */
  _run() {
    return new Promise((resolve, reject) => {
      try {
        const body = this.operation.serialize(this.config.data_operation_version);
        const { url } = this.params;
        this.logger.info('Submitting HTTP backend service request', { url });
        const uri = new URL.URL(url);
        // We need to cram the string URL into a request object for Replay to work
        const requestOptions = {
          protocol: uri.protocol,
          username: uri.username,
          password: uri.password,
          host: uri.hostname,
          port: uri.port,
          path: `${uri.pathname}?${uri.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        };

        const httplib = url.startsWith('https') ? https : http;

        const request = httplib.request(requestOptions, async (res) => {
          const result = {
            headers: res.headers,
            statusCode: res.statusCode,
          };

          if (!this.operation.isSynchronous) {
            if (res.statusCode >= 400) {
              const trx = await db.transaction();
              try {
                const { user, requestId } = this.operation;
                const job = await Job.byUsernameAndRequestId(trx, user, requestId);
                if (job) {
                  job.status = 'failed';
                  job.message = 'failed';
                  await job.save(trx);
                  await trx.commit();
                }
              } catch (e) {
                this.logger.error(e);
                await trx.rollback();
              }
            }
            // Resolve to null because we are now communicating through callbacks
            // and no active request is waiting on us
            resolve(null);
            return;
          }

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
