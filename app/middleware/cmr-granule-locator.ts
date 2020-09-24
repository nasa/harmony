import { NextFunction } from 'express';
import { getMaxAsynchronousGranules } from 'models/services/base-service';
import keysToLowerCase from 'util/object';
import * as cmr from '../util/cmr';
import { CmrError, RequestValidationError, ServerError } from '../util/errors';
import { HarmonyGranule } from '../models/data-operation';
import HarmonyRequest from '../models/harmony-request';
import { computeMbr, Mbr } from '../util/spatial/mbr';
import env from '../util/env';

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
function getBbox(collection: cmr.CmrCollection, granule: cmr.CmrGranule): Mbr {
  // use the given bounding box (if any), else try to use the given spatial geometry
  // to find a box; if there is none, use the spatial geometry from the collection; if
  // there is none default to a bounding box for the whole world
  return computeMbr(granule)
    || computeMbr(collection)
    || [-180, -90, 180, 90];
}

/**
 * Express.js middleware which extracts parameters from the Harmony operation
 * and performs a granule query on them, determining which files are applicable
 * to the given operation.
 *
 * @param {http.IncomingMessage} req The client request, containing an operation
 * @param {http.ServerResponse} res The client response
 * @param {Function} next The next function in the middleware chain
 * @returns {void}
 */
export default async function cmrGranuleLocator(req, res, next: NextFunction): Promise<void> {
  const { operation } = req;
  const query = keysToLowerCase(req.query);
  const { logger, serviceConfig } = req.context;

  if (!operation) return next();

  let cmrResponse;

  const cmrQuery: cmr.CmrQuery = {};

  if (operation.temporal) {
    const { start, end } = operation.temporal;
    cmrQuery.temporal = `${start || ''},${end || ''}`;
  }
  if (operation.boundingRectangle) {
    cmrQuery.bounding_box = operation.boundingRectangle.join(',');
  }

  cmrQuery.concept_id = operation.granuleIds;

  operation.cmrHits = 0;
  try {
    const { sources } = operation;
    const queries = sources.map(async (source) => {
      logger.info(`Querying granules ${source.collection}, ${JSON.stringify(cmrQuery)}`);
      const startTime = new Date().getTime();
      let maxResults = getMaxAsynchronousGranules(serviceConfig);
      if ('maxresults' in query) {
        // Let a user request more granules than the service allows, but may not exceed the
        // overall system limit.
        maxResults = Math.min(env.maxGranuleLimit, query.maxresults);
      }
      operation.maxResults = maxResults;

      if (operation.geojson) {
        cmrQuery.geojson = operation.geojson;
        cmrResponse = await cmr.queryGranulesForCollectionWithMultipartForm(
          source.collection,
          cmrQuery,
          req.accessToken,
          maxResults,
        );
      } else {
        cmrResponse = await cmr.queryGranulesForCollection(
          source.collection,
          cmrQuery,
          req.accessToken,
          maxResults,
        );
      }

      const { hits, granules: jsonGranules } = cmrResponse;

      operation.cmrHits += hits;
      const msTaken = new Date().getTime() - startTime;
      logger.info('Completed granule query', { durationMs: msTaken });
      logger.info(`Found ${hits} granules`);
      const granules = [];
      for (const granule of jsonGranules) {
        const links = granule.links.filter((g) => g.rel.endsWith('/data#') && !g.inherited);
        if (links.length > 0) {
          const collection = getCollectionFromRequest(req, source.collection);
          const box = getBbox(collection, granule);
          const gran: HarmonyGranule = {
            id: granule.id,
            name: granule.title,
            urls: links.map((l) => l.href),
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
