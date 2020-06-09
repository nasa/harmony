import { URL } from 'url';
import { NextFunction } from 'express';
import { objectStoreForProtocol } from '../util/object-store';
import { NotFoundError } from '../util/errors';

/**
 * Given a URL that is not necessarily public-facing, produces a URL to that data
 * which can be used to reference the data so long as it exists at the source location.
 *
 * Algorithmically:
 *    - If the link is of the form "s3://<some-bucket>/public/<some-path>", it gets transformed
 *      into a "<frontend-root>/service-results/<some-bucket>/<some-path>", which `getServiceResult`
 *      will correctly interpret and pre-sign.
 *    - If the link is an s3:// link whose path does not start with "/public/", throws a TypeError
 *    - If the link starts with "https?://" or "s?ftp://" it is assumed to already be a public-facing
 *      URL and is returned unchanged.
 *    - If the link is anything else, throws a TypeError
 *
 * @param {string} url a URL to the data location
 * @param {string} frontendRoot The root URL to use when producing URLs relative to the Harmony root
 * @param {string} mimeType The mime type of the link
 * @returns {string} a URL which getServiceResult can route to when mounted to the site root
 * @throws {TypeError} If the provided URL cannot be handled
 */
export function createPublicPermalink(
  url: string, frontendRoot: string, mimeType?: string,
): string {
  const parsed = new URL(url);
  const protocol = parsed.protocol.toLowerCase().replace(/:$/, '');
  if (protocol === 's3') {
    if (mimeType === 'application/x-zarr') {
      return url;
    }

    // Right now we only handle permalinks to S3.  We also don't capture the
    // protocol information in the URL, which would need to be incorporated if we
    // ever allow the simultaneous use of multiple object store vendors
    if (!parsed.pathname.startsWith('/public/')) {
      throw new TypeError(`Staged objects must have prefix /public/ or they will not be accessible: ${url}`);
    }
    return `${frontendRoot}/service-results/${parsed.host}${parsed.pathname}`;
  }
  if (['https', 'http', 'sftp', 'ftp'].includes(protocol)) {
    return url;
  }
  throw new TypeError(`Cannot handle URL: ${url}`);
}

/**
 * Express.js handler that returns redirects to pre-signed URLs
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {Function} next The next function in the call chain
 * @returns {Promise<void>} Resolves when the request is complete
 * @throws {NotFoundError} if the given URL cannot be signed, typically due to permissions
 */
export async function getServiceResult(req, res, next: NextFunction): Promise<void> {
  const { bucket, key } = req.params;
  const url = `s3://${bucket}/${key}`;

  const objectStore = objectStoreForProtocol('s3');
  if (objectStore) {
    try {
      req.context.logger.info(`Signing ${url}`);
      const result = await objectStore.signGetObject(url, { 'A-userid': req.user });
      // Direct clients to reuse the redirect for 10 minutes before asking for a new one
      res.append('Cache-Control', 'private, max-age=600');
      res.redirect(307, result);
    } catch (e) {
      // Thrown if signing fails, either due to inadequate bucket permissions or
      // an object not existing.
      req.context.logger.error(`Error signing URL "${url}": ${e}`);
      next(new NotFoundError());
    }
  } else {
    // Should never happen as long as we're only dealing with S3
    req.context.logger.error(`No object store found for URL "${url}"`);
    next(new NotFoundError());
  }
}
