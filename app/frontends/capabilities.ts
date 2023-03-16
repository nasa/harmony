import HarmonyRequest from '../models/harmony-request';
import { Response, NextFunction } from 'express';
import { keysToLowerCase } from '../util/object';
import { RequestValidationError } from '../util/errors';
import { CmrCollection, getCollectionsByIds, getVariablesForCollection } from '../util/cmr';
import { addCollectionsToServicesByAssociation } from '../middleware/service-selection';
import _ from 'lodash';
import { ServiceConfig } from '../models/services/base-service';

/**
 * Loads the collection info from CMR
 *
 * @param collectionId - the CMR concept ID for the collection
 * @returns the collection info
 */
async function loadCollectionInfo(collectionId: string, token: string): Promise<CmrCollection> {
  const collections = await getCollectionsByIds([collectionId], token);
  // Could not find the collection
  if (collections.length === 0) {
    const message = `${collectionId} must be a CMR collection identifier, but `
    + 'we could not find a matching collection. Please make sure the collection ID'
    + 'is correct and that you have access to it.';
    throw new RequestValidationError(message);
  }
  const collection = collections[0];
  collection.variables = await getVariablesForCollection(collection, token);
  return collection;
}

interface CollectionCapabilities {
  conceptId: string;
  shortName: string;
  variableSubset: boolean;
  bboxSubset: boolean;
  shapeSubset: boolean;
  concatenate: boolean;
  reproject: boolean;
  outputFormats: string[];
  services: ServiceConfig<unknown>[];
  variables: string[];
}

/**
 * Resolves to a CollectionCapabilities object detailing the harmony transformation capabilities
 * for the given collection.
 *
 * @param collectionId - the CMR collection concept ID
 * @param cmrCollections - a list of CMR collections relevant to the user request
 * @param token - the user's EDL access token
 * @returns a promise resolving to the collection capabilities
 */
async function getCollectionCapabilities(
  collectionId: string, token: string, cmrCollections: CmrCollection[],
) : Promise<CollectionCapabilities> {
  const collection = await loadCollectionInfo(collectionId, token);
  const allServiceConfigs = addCollectionsToServicesByAssociation(cmrCollections);
  const matchingServices = allServiceConfigs.filter((config) =>
    config.collections.map((c) => c.id).includes(collection.id));
  const variables = collection.variables.map((v) => v.umm.Name);
  const variableSubset = variables.length > 0
      && matchingServices.some((s) => s.capabilities.subsetting.variable === true);
  const bboxSubset = matchingServices.some((s) => s.capabilities.subsetting.bbox === true);
  const shapeSubset = matchingServices.some((s) => s.capabilities.subsetting.shape === true);
  const concatenate = matchingServices.some((s) => s.capabilities.concatenation === true);
  const reproject = matchingServices.some((s) => s.capabilities.reprojection === true);
  const outputFormats = new Set(matchingServices.flatMap((s) => s.capabilities.output_formats));
  const conceptId = collection.id;
  const shortName = collection.short_name;
  const services = matchingServices.map((s) => _.pick(s, ['name', 'capabilities']));
  const capabilities = { conceptId, shortName, variableSubset, bboxSubset, shapeSubset,
    concatenate, reproject, outputFormats: Array.from(outputFormats), services, variables,
  };
  return capabilities;
}

/**
 * Endpoint to display information related to what harmony operations are supported for a
 * given collection in JSON format.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The job links (pause, resume, etc.)
 */
export async function displayCollectionCapabilities(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const query = keysToLowerCase(req.query);
  const { collectionid } = query;
  if (!collectionid) {
    throw new RequestValidationError('Missing required parameter collectionId');
  } try {
    const capabilities = await getCollectionCapabilities(
      collectionid, req.accessToken, req.collections,
    );
    res.send(capabilities);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Endpoint to display information related to what harmony operations are supported for a
 * given collection in HTML format.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The job links (pause, resume, etc.)
 */
export async function displayCollectionCapabilitiesHtml(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const query = keysToLowerCase(req.query);
  const { collectionid } = query;
  if (!collectionid) {
    throw new RequestValidationError('Missing required parameter collectionId');
  } try {
    const capabilities = await getCollectionCapabilities(
      collectionid, req.accessToken, req.collections,
    );
    res.render('capabilities/index', { capabilities });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}
