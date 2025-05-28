import { NextFunction, Response } from 'express';
import { LRUCache } from 'lru-cache';
import { URL } from 'url';

import HarmonyRequest from '../models/harmony-request';
import { Job } from '../models/job';
import db from '../util/db';
import env from '../util/env';
import { NotFoundError } from '../util/errors';
import { objectStoreForProtocol } from '../util/object-store';

/**
 * Given a URL that is not necessarily public-facing, produces a URL to that data
 * which can be used to reference the data so long as it exists at the source location.
 *
 * Algorithmically:
 *     - If the link is of the form "s3://<some-bucket>/public/<some-path>" AND `linkType` is 's3'
 *       or `mimeType` is 'application/x-zarr' then the url is returned as is.
 *    - If the link is of the form "s3://<some-bucket>/public/<some-path>", it gets transformed
 *      into a "<frontend-root>/service-results/<some-bucket>/<some-path>", which `getServiceResult`
 *      will correctly interpret and pre-sign.
 *    - If the link is an s3:// link whose path does not start with "/public/", throws a TypeError
 *    - If the link starts with "https?://" or "s?ftp://" it is assumed to already be a public-facing
 *      URL and is returned unchanged.
 *    - If the link is anything else, throws a TypeError
 *
 * @param url - a URL to the data location
 * @param frontendRoot - The root URL to use when producing URLs relative to the Harmony root
 * @param mimeType - The mime type of the link
 * @param linkType - the type to use for data links (http|https =\> https | s3 =\> s3)
 * @returns a URL which getServiceResult can route to when mounted to the site root
 * @throws TypeError - If the provided URL cannot be handled
 */
export function createPublicPermalink(
  url: string, frontendRoot: string, mimeType?: string, linkType?: string,
): string {
  const parsed = new URL(url);
  const protocol = parsed.protocol.toLowerCase().replace(/:$/, '');
  if (protocol === 's3') {
    if (mimeType === 'application/x-zarr' || linkType === 's3') {
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
 * Wrapper function of getProviderIdForJobId to be set to fetchMethod of LRUCache.
 *
 * @param jobId - the job identifier
 * @param _sv - stale value parameter of LRUCache fetchMethod, unused here
 * @param options - options parameter of LRUCache fetchMethod, carries the request context
 * @returns resolves to the provider id for the job
 */
async function fetchProviderId(jobId: string, _sv: string, { context }): Promise<string> {
  context.logger.info(`Fetching provider id for job id ${jobId}`);
  return Job.getProviderIdForJobId(db, jobId);
}

// In memory cache for Job ID to provider Id
export const providerIdCache = new LRUCache({
  ttl: env.providerCacheTtl,
  maxSize: env.providerCacheSize,
  sizeCalculation: (value: string): number => value.length,
  fetchMethod: fetchProviderId,
});

/**
 * Express.js handler that returns redirects to pre-signed URLs
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 * @throws NotFoundError - if the given URL cannot be signed, typically due to permissions
 */
export async function getServiceResult(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { bucket, jobId, workItemId, remainingPath } = req.params;

  // Service results for outputs produced by harmony will include a jobId and workItemId in the
  // path. The test data stored in harmony buckets in the UAT account which we use the
  // service-results route to access will only have the bucket and key in the URL
  const key = (!jobId || !workItemId) ? remainingPath : `public/${jobId}/${workItemId}/${remainingPath}`;
  const url = `s3://${bucket}/${key}`;

  const provider = jobId ? await providerIdCache.fetch(jobId, { context: req.context }) : undefined;

  const objectStore = objectStoreForProtocol('s3');
  if (objectStore) {
    try {
      const customParams = { 'A-userid': req.user };
      if (jobId) {
        customParams['A-api-request-uuid'] = jobId;
      }
      if (provider) {
        customParams['A-provider'] = provider.toUpperCase();
      }
      req.context.logger.info(`Signing ${url} with params ${JSON.stringify(customParams)}`);
      const result = await objectStore.signGetObject(url, customParams);
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
