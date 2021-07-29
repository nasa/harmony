import { NextFunction } from 'express';
import { keysToLowerCase } from 'util/object';
import { ServerResponse } from 'http';
import _ from 'lodash';
import * as cmr from '../util/cmr';
import { CmrError, RequestValidationError, ServerError } from '../util/errors';
import DataOperation, { HarmonyGranule } from '../models/data-operation';
import HarmonyRequest from '../models/harmony-request';
import { computeMbr } from '../util/spatial/mbr';
import { BoundingBox } from '../util/bounding-box';
import env from '../util/env';
import { defaultObjectStore } from '../util/object-store';

/**
 * Gets collection from request that matches the given id
 * @param req - The client request
 * @param collectionId - the CMR concept id of the collection to find
 * @returns the collection from the request that has the given id
 */
function getCollectionFromRequest(req: HarmonyRequest, collectionId: string): cmr.CmrCollection {
  return req.collections.find((collection) => collection.id === collectionId);
}

/**
 * Gets bbox
 * @param collection - a CMR collection record
 * @param granule  -  a CMR granule record associated with the `collection`
 * @returns bbox  - a bounding box in [W S E N] format
 */
function getBbox(collection: cmr.CmrCollection, granule: cmr.CmrGranule): BoundingBox {
  // use the given bounding box (if any), else try to use the given spatial geometry
  // to find a box; if there is none, use the spatial geometry from the collection; if
  // there is none default to a bounding box for the whole world
  return computeMbr(granule)
    || computeMbr(collection)
    || [-180, -90, 180, 90];
}

/**
 * Returns from the maximum number of granules to return from the CMR.
 */
function getMaxGranules(req: HarmonyRequest): number {
  const query = keysToLowerCase(req.query);

  let maxResults = env.maxGranuleLimit;
  if ('maxresults' in query) {
    maxResults = Math.min(env.maxGranuleLimit, query.maxresults);
  }
  return maxResults;
}

/**
 * Returns a warning message if not all matching granules will be processed for the request
 *
 * @returns a warning message if not all matching granules will be processed, or undefined
 * if not applicable
 */
function getResultsLimitedMessage(operation: DataOperation): string {
  let numGranules = operation.cmrHits;
  if (operation.maxResults) {
    numGranules = Math.min(numGranules, operation.maxResults, env.maxGranuleLimit);
  } else {
    numGranules = Math.min(numGranules, env.maxGranuleLimit);
  }

  let message;
  if (operation.cmrHits > numGranules) {
    message = `CMR query identified ${operation.cmrHits} granules, but the request has been limited `
     + `to process only the first ${numGranules} granules`;
    if (operation.maxResults && operation.maxResults < env.maxGranuleLimit) {
      message += ` because you requested ${operation.maxResults} maxResults.`;
    } else {
      message += ' because of system constraints.';
    }
  }
  return message;
}

/**
 * Express.js middleware which extracts parameters from the Harmony operation
 * and performs a granule query on them, determining which files are applicable
 * to the given operation.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
async function cmrGranuleLocatorNew(
  req: HarmonyRequest, res: ServerResponse, next: NextFunction,
): Promise<void> {
  // Same boilerplate as before
  const { operation } = req;
  const { logger } = req.context;

  if (!operation) return next();

  const cmrQuery: cmr.CmrQuery = {};

  const start = operation.temporal?.start;
  const end = operation.temporal?.end;
  if (start || end) {
    cmrQuery.temporal = `${start || ''},${end || ''}`;
  }
  if (operation.boundingRectangle) {
    cmrQuery.bounding_box = operation.boundingRectangle.join(',');
  }

  cmrQuery.concept_id = operation.granuleIds;

  operation.cmrHits = 0;
  operation.scrollIDs = [];

  try {
    const { sources } = operation;
    const queries = sources.map(async (source) => {
      logger.info(`Querying granules for ${source.collection}`, { cmrQuery, collection: source.collection });
      const startTime = new Date().getTime();
      const maxResults = getMaxGranules(req);

      operation.maxResults = maxResults;

      if (operation.geojson) {
        cmrQuery.geojson = operation.geojson;
      }

      const { hits, scrollID } = await cmr.initateGranuleScroll(
        source.collection,
        cmrQuery,
        req.accessToken,
        maxResults,
      );
      const msTaken = new Date().getTime() - startTime;
      logger.info('timing.cmr-initiate-granule-scroll.end', { durationMs: msTaken, hits });

      operation.cmrHits += hits;
      operation.scrollIDs.push(scrollID);
    });
    await Promise.all(queries);
  } catch (e) {
    if (e instanceof RequestValidationError || e instanceof CmrError) {
      // Avoid giving confusing errors about GeoJSON due to upstream converted files
      if (e.message.indexOf('GeoJSON') !== -1 && req.context.shapefile) {
        e.message = e.message.replace('GeoJSON', `GeoJSON (converted from the provided ${req.context.shapefile.typeName})`);
      }
      return next(e);
    }
    logger.error(e);
    next(new ServerError('Failed to query the CMR'));
  }
  return next();
}

/**
 * Express.js middleware which extracts parameters from the Harmony operation
 * and performs a granule query on them, determining which files are applicable
 * to the given operation.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
async function cmrGranuleLocatorArgo(
  req: HarmonyRequest, res: ServerResponse, next: NextFunction,
): Promise<void> {
  const { operation } = req;
  const { logger } = req.context;

  if (!operation) return next();

  let cmrResponse;

  const cmrQuery: cmr.CmrQuery = {};

  const start = operation.temporal?.start;
  const end = operation.temporal?.end;
  if (start || end) {
    cmrQuery.temporal = `${start || ''},${end || ''}`;
  }
  if (operation.boundingRectangle) {
    cmrQuery.bounding_box = operation.boundingRectangle.join(',');
  }

  cmrQuery.concept_id = operation.granuleIds;

  operation.cmrHits = 0;
  try {
    const artifactPrefix = `s3://${env.artifactBucket}/harmony-inputs/query/${req.context.id}/`;
    const { sources } = operation;
    const queries = sources.map(async (source, i) => {
      logger.info(`Querying granules for ${source.collection}`, { cmrQuery, collection: source.collection });
      const startTime = new Date().getTime();
      const maxResults = getMaxGranules(req);

      operation.maxResults = maxResults;

      if (operation.geojson) {
        cmrQuery.geojson = operation.geojson;
      }
      cmrResponse = await cmr.queryGranulesForCollection(
        source.collection,
        cmrQuery,
        req.accessToken,
        maxResults,
      );

      const indexStr = `${i}`.padStart(5, '0');
      const artifactUrl = `${artifactPrefix}query${indexStr}.json`;
      await defaultObjectStore().upload(JSON.stringify(cmrQuery), artifactUrl);
      operation.cmrQueryLocations.push(artifactUrl);

      const { hits, granules: jsonGranules } = cmrResponse;

      operation.cmrHits += hits;
      const msTaken = new Date().getTime() - startTime;
      logger.info('timing.cmr-granule-query.end', { durationMs: msTaken, hits });
      const granules = [];
      for (const granule of jsonGranules) {
        const links = cmr.filterGranuleLinks(granule);
        if (links.length > 0) {
          const collection = getCollectionFromRequest(req, source.collection);
          const box = getBbox(collection, granule);
          const gran: HarmonyGranule = {
            id: granule.id,
            name: granule.title,
            url: links[0].href,
            bbox: box,
            temporal: {
              start: granule.time_start,
              end: granule.time_end,
            },
          };
          granules.push(gran);
        }
      }
      if (granules.length === 0) {
        throw new RequestValidationError('No matching granules found.');
      }
      return Object.assign(source, { granules });
    });

    await Promise.all(queries);
    operation.cmrQueryLocations = operation.cmrQueryLocations.sort();
    const limitedMessage = getResultsLimitedMessage(operation);
    if (limitedMessage) {
      req.context.messages.push(getResultsLimitedMessage(operation));
    }
  } catch (e) {
    if (e instanceof RequestValidationError || e instanceof CmrError) {
      // Avoid giving confusing errors about GeoJSON due to upstream converted files
      if (e.message.indexOf('GeoJSON') !== -1 && req.context.shapefile) {
        e.message = e.message.replace('GeoJSON', `GeoJSON (converted from the provided ${req.context.shapefile.typeName})`);
      }
      return next(e);
    }
    logger.error(e);
    next(new ServerError('Failed to query the CMR'));
  }
  return next();
}

/**
 * Express.js middleware which extracts parameters from the Harmony operation
 * and performs a granule query on them, determining which files are applicable
 * to the given operation.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default async function cmrGranuleLocator(
  req: HarmonyRequest, res: ServerResponse, next: NextFunction,
): Promise<void> {
  if (req.query.turbo === 'true') {
    await cmrGranuleLocatorNew(req, res, next);
  } else {
    await cmrGranuleLocatorArgo(req, res, next);
  }
}
