import * as http from 'http';
import * as https from 'https';
import * as URL from 'url';
import { Job } from '../job';
import BaseService from './base-service';
import InvocationResult from './invocation-result';
import db from '../../util/db';

export interface HttpServiceParams {
  url: string;
}

/**
 * Service implementation which invokes a backend over HTTP, POSTing the Harmony
 * message to its configured endpoint and conveying its response back to the caller,
 * or creating a Job to poll and listening for service updates for async services.
 *
 */
export default class HttpService extends BaseService<HttpServiceParams> {
  /**
   * Only support non-turbo runs for the stub service
   */
  isTurbo(): boolean { return false; }

  /**
   * Calls the HTTP backend and returns a promise for its result
   * @returns A promise resolving to the result of the callback.
   */
  _run(logger): Promise<InvocationResult> {
    return new Promise((resolve, reject) => {
      try {
        const body = this.serializeOperation();
        const Authorization = `Bearer ${this.operation.unencryptedAccessToken}`;
        const { url } = this.params;
        logger.info('Submitting HTTP backend service request', { url });
        const uri = new URL.URL(url);
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
            Authorization,
          },
        };

        const httplib = url.startsWith('https') ? https : http;

        const request = httplib.request(requestOptions, async (res) => {
          const result: InvocationResult = {
            headers: res.headers,
            statusCode: res.statusCode,
          };

          if (!this.operation.isSynchronous && res.statusCode >= 400) {
            // Asynchronous error
            const trx = await db.transaction();
            try {
              const { user, requestId } = this.operation;
              const { job } = await Job.byUsernameAndRequestId(trx, user, requestId);
              if (job) {
                job.fail();
                await job.save(trx);
                await trx.commit();
              }
            } catch (e) {
              logger.error(e);
              await trx.rollback();
            }
            resolve(null);
          } else if (!this.operation.isSynchronous || res.statusCode === 202) {
            // Asynchronous success
            resolve(null); // Success.  Further communication is via callback
          } else if (res.statusCode < 300) {
            // Synchronous success
            result.stream = res;
            resolve(result);
          } else if (res.statusCode < 400) {
            // Synchronous redirect
            result.redirect = res.headers.location;
            resolve(result);
          } else {
            // Synchronous error
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
        logger.error(e);
        reject(e);
      }
    });
  }
}
