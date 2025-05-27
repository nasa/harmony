import { NextFunction } from 'express';
import { ServerResponse } from 'http';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import { keysToLowerCase } from '../util/object';
import { CmrError, RequestValidationError, ServerError } from '../util/errors';
import { HarmonyGranule } from '../models/data-operation';
import HarmonyRequest from '../models/harmony-request';
import { computeMbr } from '../util/spatial/mbr';
import { BoundingBox } from '../util/bounding-box';
import env from '../util/env';
import { defaultObjectStore } from '../util/object-store';
import { CmrCollection, CmrGranule, CmrQuery, filterGranuleLinks, s3UrlForStoredQueryParams, queryGranulesForCollection, queryGranulesWithSearchAfter } from '../util/cmr';

/** Reasons why the number of processed granules might be limited to less than what the CMR
 * returns
 */
export enum GranuleLimitReason {
  Collection, // limited by the collection configuration
  Service,    // limited by the service chain configuration
  MaxResults, // limited by the maxResults query parameter
  System,     // limited by the system environment
  None,       // not limited
}

/**
 * Gets collection from request that matches the given id
 * @param req - The client request
 * @param collectionId - the CMR concept id of the collection to find
 * @returns the collection from the request that has the given id
 */
function getCollectionFromRequest(req: HarmonyRequest, collectionId: string): CmrCollection {
  return req.context.collections.find((collection) => collection.id === collectionId);
}

/**
 * Gets bbox
 * @param collection - a CMR collection record
 * @param granule  -  a CMR granule record associated with the `collection`
 * @returns bbox  - a bounding box in [W S E N] format
 */
function getBbox(collection: CmrCollection, granule: CmrGranule): BoundingBox {
  // use the given bounding box (if any), else try to use the given spatial geometry
  // to find a box; if there is none, use the spatial geometry from the collection; if
  // there is none default to a bounding box for the whole world
  return computeMbr(granule)
    || computeMbr(collection)
    || [-180, -90, 180, 90];
}

/**
 * Get the maximum number of granules that should be used from the CMR results
 *
 * @param req - The client request, containing an operation
 * @param collection - The id of the collection to which the granules belong
 * @returns an object containing the maximum number of granules to return from the CMR and the
 * reason why it is being limited
 */
function getMaxGranules(req: HarmonyRequest, collection: string):
{ maxGranules: number; reason: GranuleLimitReason; } {
  let reason = GranuleLimitReason.None;
  let maxResults = Number.MAX_SAFE_INTEGER;

  if (req.context.serviceConfig.has_granule_limit !== false) {
    const query = keysToLowerCase(req.query);
    const { context } = req;
    maxResults = env.maxGranuleLimit;
    reason = GranuleLimitReason.System;

    if ('maxresults' in query && query.maxresults < maxResults) {
      maxResults = query.maxresults;
      reason = GranuleLimitReason.MaxResults;
    }

    const { serviceConfig } = context;
    if (serviceConfig.granule_limit && serviceConfig.granule_limit < maxResults) {
      maxResults = serviceConfig.granule_limit;
      reason = GranuleLimitReason.Service;
    }

    const serviceCollection = serviceConfig.collections?.find((sc) => sc.id === collection);
    if (serviceCollection &&
      serviceCollection.granule_limit &&
      serviceCollection.granule_limit < maxResults) {
      maxResults = serviceCollection.granule_limit;
      reason = GranuleLimitReason.Collection;
    }
  }

  return { maxGranules: maxResults, reason };
}

/**
 * Constructs the base of the results limited message.
 * @param hits - number of CMR hits
 * @param maxGranules - limit for granule processing
 * @returns the base of the results limited message
 */
export function baseResultsLimitedMessage(hits: number, maxGranules: number): string {
  return `CMR query identified ${hits} granules, but the request has been limited `
    + `to process only the first ${maxGranules} granules`;
}

/**
 * Create a message indicating that the results have been limited and why - if necessary
 *
 * @param cmrHits - The number of granules that matched the CMR query
 * @param maxResults - The maximum number of results requested by the user
 * @param maxGranules - The maximum number of granules that should be used from the CMR results
 * @param reason - The reason of result limitation
 * @param serviceName - The name of the service
 * @param hasGranuleLimit - Whether the service config enforces a granule limit
 * @param collection - The id of the collection to which the granules belong
 * @returns a warning message if not all matching granules will be processed, or undefined
 * if not applicable
 */
export function getResultsLimitedMessageImpl(
  cmrHits: number,
  maxResults: number,
  maxGranules: number,
  reason: GranuleLimitReason,
  serviceName: string,
  hasGranuleLimit: boolean,
  collection: string,
): string {
  let message;
  if (hasGranuleLimit == false) return;

  if (cmrHits > maxGranules) {
    message = baseResultsLimitedMessage(cmrHits, maxGranules);

    switch (reason) {
      case GranuleLimitReason.MaxResults:
        message += ` because you requested ${maxResults} maxResults.`;
        break;

      case GranuleLimitReason.Service:
        message += ` because the service ${serviceName} is limited to ${maxGranules}.`;
        break;

      case GranuleLimitReason.Collection:
        message += ` because collection ${collection} is limited to ${maxGranules} for the ${serviceName} service.`;
        break;

      default:
        message += ' because of system constraints.';
        break;
    }
  }
  return message;
}

/**
 * Create a message indicating that the results have been limited and why - if necessary
 *
 * @param req - The client request, containing an operation
 * @param collection - The id of the collection to which the granules belong
 * @returns a warning message if not all matching granules will be processed, or undefined
 * if not applicable
 */
function getResultsLimitedMessage(req: HarmonyRequest, collection: string): string {
  const { operation } = req;
  const { cmrHits, maxResults } = operation;
  const { maxGranules, reason } = getMaxGranules(req, collection);
  const { name, has_granule_limit } = req.context.serviceConfig;

  return getResultsLimitedMessageImpl(
    cmrHits,
    maxResults,
    maxGranules,
    reason,
    name,
    has_granule_limit,
    collection,
  );
}

/**
 * Express.js middleware which extracts parameters from the Harmony operation
 * and performs a granule query on them, determining which files are applicable
 * to the given operation. Adds a CMR scrolling ID to be used by the query-cmr
 * task to retrieve the granules as part of a turbo workflow.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
async function cmrGranuleLocatorTurbo(
  req: HarmonyRequest, res: ServerResponse, next: NextFunction,
): Promise<void> {
  // Same boilerplate as before
  const { operation } = req;
  const { logger } = req.context;

  if (!operation) return next();

  const cmrQuery: CmrQuery = {};

  const start = operation.temporal?.start;
  const end = operation.temporal?.end;
  if (start || end) {
    cmrQuery.temporal = `${start || ''},${end || ''}`;
  }
  if (operation.boundingRectangle) {
    cmrQuery.bounding_box = operation.boundingRectangle.join(',');
  } else if (operation.spatialPoint) {
    cmrQuery.point = operation.spatialPoint.join(',');
  }

  cmrQuery.concept_id = operation.granuleIds;
  cmrQuery.readable_granule_name = operation.granuleNames;
  operation.cmrHits = 0;
  operation.scrollIDs = [];

  try {
    const { sources } = operation;
    const queries = sources.map(async (source) => {
      logger.info(`Querying granules for ${source.collection}`, { cmrQuery, collection: source.collection });
      const startTime = new Date().getTime();
      const { maxGranules } = getMaxGranules(req, source.collection);

      operation.maxResults = maxGranules;

      if (operation.geojson) {
        cmrQuery.geojson = operation.geojson;
      }

      // Only perform CMR granule query when needed by the first step
      if ( req.context.serviceConfig.steps[0].image.match('harmonyservices/query-cmr:.*') ) {
        cmrQuery.collection_concept_id = source.collection;
        const { hits, sessionKey } = await queryGranulesWithSearchAfter(
          req.context,
          req.accessToken,
          maxGranules,
          cmrQuery,
        );
        if (hits === 0) {
          throw new RequestValidationError('No matching granules found.');
        }
        const msTaken = new Date().getTime() - startTime;
        logger.info('timing.cmr-initiate-granule-scroll.end', { durationMs: msTaken, hits });

        operation.cmrHits += hits;
        operation.scrollIDs.push(sessionKey);
      }

      const limitedMessage = getResultsLimitedMessage(req, source.collection);
      if (limitedMessage) {
        req.context.messages.push(limitedMessage);
      }
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
 * Still used for HTTP based services
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
async function cmrGranuleLocatorNonTurbo(
  req: HarmonyRequest, res: ServerResponse, next: NextFunction,
): Promise<void> {
  const { operation } = req;
  const { logger } = req.context;

  if (!operation) return next();

  let cmrResponse;

  const cmrQuery: CmrQuery = {};

  const start = operation.temporal?.start;
  const end = operation.temporal?.end;
  if (start || end) {
    cmrQuery.temporal = `${start || ''},${end || ''}`;
  }
  if (operation.boundingRectangle) {
    cmrQuery.bounding_box = operation.boundingRectangle.join(',');
  } else if (operation.spatialPoint) {
    cmrQuery.point = operation.spatialPoint.join(',');
  }

  cmrQuery.concept_id = operation.granuleIds;
  cmrQuery.readable_granule_name = operation.granuleNames;

  operation.cmrHits = 0;
  try {
    const artifactPrefix = `s3://${env.artifactBucket}/harmony-inputs/query/${req.context.id}/`;
    const { sources } = operation;
    const queries = sources.map(async (source, i) => {
      logger.info(`Querying granules for ${source.collection}`, { cmrQuery, collection: source.collection });
      const startTime = new Date().getTime();
      const { maxGranules } = getMaxGranules(req, source.collection);

      operation.maxResults = maxGranules;

      if (operation.geojson) {
        cmrQuery.geojson = operation.geojson;
      }
      cmrResponse = await queryGranulesForCollection(
        req.context,
        source.collection,
        cmrQuery,
        req.accessToken,
        maxGranules,
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
        const links = filterGranuleLinks(granule);
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
      const limitedMessage = getResultsLimitedMessage(req, source.collection);
      if (limitedMessage) {
        req.context.messages.push(limitedMessage);
      }
      return Object.assign(source, { granules });
    });

    await Promise.all(queries);
    operation.cmrQueryLocations = operation.cmrQueryLocations.sort();
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
 * and save them in s3 and set up extraArgs in request operation to be used
 * for granule validation in the query-cmr step later.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
async function asyncGranuleLocator(
  req: HarmonyRequest, res: ServerResponse, next: NextFunction,
): Promise<void> {
  const { operation } = req;
  const { logger } = req.context;

  if (!operation) return next();

  const cmrQuery: CmrQuery = {};

  const start = operation.temporal?.start;
  const end = operation.temporal?.end;
  if (start || end) {
    cmrQuery.temporal = `${start || ''},${end || ''}`;
  }
  if (operation.boundingRectangle) {
    cmrQuery.bounding_box = operation.boundingRectangle.join(',');
  } else if (operation.spatialPoint) {
    cmrQuery.point = operation.spatialPoint.join(',');
  }

  cmrQuery.concept_id = operation.granuleIds;
  cmrQuery.readable_granule_name = operation.granuleNames;

  operation.scrollIDs = [];

  try {
    const { sources } = operation;
    logger.info(`Storing query params in S3 for ${sources[0].collection}`, { cmrQuery, collection: sources[0].collection });
    const startTime = new Date().getTime();
    const { maxGranules, reason } = getMaxGranules(req, sources[0].collection);

    operation.maxResults = maxGranules;
    operation.cmrHits = operation.granuleIds?.length || maxGranules;

    if (operation.geojson) {
      cmrQuery.geojson = operation.geojson;
    }

    // Only store query params in S3 when needed by the first step
    if ( req.context.serviceConfig.steps[0].image.match('harmonyservices/query-cmr:.*') ) {
      cmrQuery.collection_concept_id = sources[0].collection;
      // generate a session key and store the query parameters in the staging bucket using the key
      const sessionKey = uuid();
      const url = s3UrlForStoredQueryParams(sessionKey);
      await defaultObjectStore().upload(JSON.stringify(cmrQuery), url);

      const msTaken = new Date().getTime() - startTime;
      logger.info('timing.storing-query-params-in-s3.end', { durationMs: msTaken });

      operation.scrollIDs.push(sessionKey);

      const hasGranuleLimit = req.context.serviceConfig.has_granule_limit;
      const serviceName = req.context.serviceConfig.name;
      const shapeType = req.context.shapefile?.typeName;
      operation.extraArgs = { granValidation: { reason, hasGranuleLimit, serviceName, shapeType, maxResults: operation.maxResults } };
    }

  } catch (e) {
    logger.error(e);
    next(new ServerError('Failed to store query params in S3'));
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
  if (req.query.forceAsync === 'true' && req.operation.granuleIds) {
    await asyncGranuleLocator(req, res, next);
  } else {
    if (req.context?.serviceConfig?.type?.name === 'turbo') {
      await cmrGranuleLocatorTurbo(req, res, next);
    } else {
      await cmrGranuleLocatorNonTurbo(req, res, next);
    }
  }
}
