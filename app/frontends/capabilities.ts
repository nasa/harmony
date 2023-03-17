import HarmonyRequest from '../models/harmony-request';
import { Response, NextFunction } from 'express';
import { keysToLowerCase } from '../util/object';
import { NotFoundError, RequestValidationError } from '../util/errors';
import { CmrCollection, getCollectionsByIds, getCollectionsByShortName, getVariablesForCollection } from '../util/cmr';
import { addCollectionsToServicesByAssociation } from '../middleware/service-selection';
import _ from 'lodash';
import { ServiceConfig } from '../models/services/base-service';
import { harmonyCollections } from '../models/services';

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
 * Loads the collection info from CMR using short name or concept ID passed into the harmony
 * request
 *
 * @param req - The request sent by the client
 * @returns the collection info
 * @throws NotFoundError if no collection is found or parameters are invalid
 */
async function loadCollectionInfo(req: HarmonyRequest): Promise<CmrCollection> {
  const query = keysToLowerCase(req.query);
  const { collectionid, shortname } = query;
  let collections;
  let pickedCollection;
  if (!collectionid && !shortname) {
    throw new RequestValidationError('Must specify either collectionId or shortName');
  } else if (collectionid && shortname) {
    throw new RequestValidationError('Must specify only one of collectionId or shortName, not both');
  } else if (collectionid) {
    collections = await getCollectionsByIds([collectionid], req.accessToken);
    if (collections.length === 0) {
      const message = `${collectionid} must be a CMR collection identifier, but `
      + 'we could not find a matching collection. Please make sure the collection ID'
      + 'is correct and that you have access to it.';
      throw new NotFoundError(message);
    }
    pickedCollection = collections[0];
  } else {
    collections = await getCollectionsByShortName(shortname, req.accessToken);
    if (collections.length === 0) {
      const message = `Unable to find collection short name ${shortname} in the CMR. Please `
      + ' make sure the short name is correct and that you have access to the collection.';
      throw new NotFoundError(message);
    }
    pickedCollection = collections[0];
    if (collections.length > 1) {
      // If there are multiple collections matching prefer a collection that is configured
      // for use in harmony
      const harmonyCollection = collections.find((c) => harmonyCollections.includes(c.id));
      pickedCollection = harmonyCollection || pickedCollection;
    }
  }
  pickedCollection.variables = await getVariablesForCollection(pickedCollection, req.accessToken);
  return pickedCollection;
}

/**
 * Resolves to a CollectionCapabilities object detailing the harmony transformation capabilities
 * for the given collection.
 *
 * @param collection - the CMR collection
 * @returns a promise resolving to the collection capabilities
 */
async function getCollectionCapabilities(collection: CmrCollection): Promise<CollectionCapabilities> {
  const allServiceConfigs = addCollectionsToServicesByAssociation([collection]);
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
export async function getCollectionCapabilitiesJson(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const collection = await loadCollectionInfo(req);
  try {
    const capabilities = await getCollectionCapabilities(collection);
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
export async function getCollectionCapabilitiesHtml(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const collection = await loadCollectionInfo(req);
  try {
    const capabilities = await getCollectionCapabilities(collection);
    res.render('capabilities/index', { capabilities });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}
