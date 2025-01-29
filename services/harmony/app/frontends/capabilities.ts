import HarmonyRequest from '../models/harmony-request';
import { Response, NextFunction } from 'express';
import { keysToLowerCase } from '../util/object';
import { NotFoundError, RequestValidationError } from '../util/errors';
import { CmrCollection, getCollectionsByIds, getCollectionsByShortName, getVariablesForCollection, CmrUmmVariable } from '../util/cmr';
import { addCollectionsToServicesByAssociation } from '../middleware/service-selection';
import _ from 'lodash';
import { ServiceCapabilities, ServiceConfig } from '../models/services/base-service';
import { harmonyCollections } from '../models/services';
import { listToText } from '@harmony/util/string';

export const currentApiVersion = '2';
const supportedApiVersions = ['1', '2'];

interface ServiceV2 {
  name: string;
  href: string;
  capabilities: ServiceCapabilities;
}

interface VariableV2 {
  name: string;
  href: string;
}

interface CollectionCapabilitiesV1 {
  conceptId: string;
  shortName: string;
  variableSubset: boolean;
  bboxSubset: boolean;
  shapeSubset: boolean;
  temporalSubset: boolean;
  concatenate: boolean;
  reproject: boolean;
  outputFormats: string[];
  services: ServiceConfig<unknown>[];
  variables: string[];
  capabilitiesVersion: string;
}

interface CollectionCapabilitiesV2 {
  conceptId: string;
  shortName: string;
  variableSubset: boolean;
  bboxSubset: boolean;
  shapeSubset: boolean;
  temporalSubset: boolean;
  concatenate: boolean;
  reproject: boolean;
  outputFormats: string[];
  services: ServiceV2[];
  variables: VariableV2[];
  capabilitiesVersion: string;
}

type CollectionCapabilities = CollectionCapabilitiesV1 | CollectionCapabilitiesV2;

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
    collections = await getCollectionsByIds(req.context, [collectionid], req.accessToken);
    if (collections.length === 0) {
      const message = `${collectionid} must be a CMR collection identifier, but `
        + 'we could not find a matching collection. Please make sure the collection ID '
        + 'is correct and that you have access to it.';
      throw new NotFoundError(message);
    }
    pickedCollection = collections[0];
  } else {
    collections = await getCollectionsByShortName(req.context, shortname, req.accessToken);
    if (collections.length === 0) {
      const message = `Unable to find collection short name ${shortname} in the CMR. Please `
        + 'make sure the short name is correct and that you have access to the collection.';
      throw new NotFoundError(message);
    }
    pickedCollection = collections[0];
    if (collections.length > 1) {
      // If there are multiple collections matching prefer a collection that is configured
      // for use in harmony
      const harmonyCollection = collections.find((c) => harmonyCollections(collections).includes(c.id));
      pickedCollection = harmonyCollection || pickedCollection;
    }
  }
  pickedCollection.variables = await getVariablesForCollection(req.context, pickedCollection, req.accessToken);
  return pickedCollection;
}

/**
 * Returns the service representation in capabilities version 2 format.
 *
 * @param variable - the services config object
 * @returns the service representation in capabilities version 2 format
 */
function getServiceV2(service: ServiceConfig<unknown>): ServiceV2 {
  const { name, umm_s, capabilities } = service;
  const href = `${process.env.CMR_ENDPOINT}/search/concepts/${umm_s}`;
  return { name, href, capabilities };
}

/**
 * Returns the variable representation in capabilities version 2 format.
 *
 * @param variable - the CMR umm-var object
 * @returns the variable representation in capabilities version 2 format
 */
function getVariableV2(variable: CmrUmmVariable): VariableV2 {
  const name = variable.umm.Name;
  const href = `${process.env.CMR_ENDPOINT}/search/concepts/${variable.meta['concept-id']}`;
  return { name, href };
}

/**
 * Resolves to a CollectionCapabilitiesV1 object detailing the harmony transformation capabilities
 * for the given collection in version 1 of the JSON format.
 *
 * @param collection - the CMR collection
 * @returns a promise resolving to the version 1 collection capabilities
 */
async function getCollectionCapabilitiesV1(collection: CmrCollection)
  : Promise<CollectionCapabilitiesV1> {
  const capabilitiesVersion = '1';
  const allServiceConfigs = addCollectionsToServicesByAssociation([collection]);
  const matchingServices = allServiceConfigs.filter((config) =>
    config.collections.map((c) => c.id).includes(collection.id));
  const variables = collection.variables.map((v) => v.umm.Name);
  const variableSubset = variables.length > 0
    && matchingServices.some((s) => s.capabilities.subsetting.variable === true);
  const bboxSubset = matchingServices.some((s) => s.capabilities.subsetting.bbox === true);
  const shapeSubset = matchingServices.some((s) => s.capabilities.subsetting.shape === true);
  const temporalSubset = matchingServices.some((s) => s.capabilities.subsetting.temporal === true);
  const concatenate = matchingServices.some((s) => s.capabilities.concatenation === true);
  const reproject = matchingServices.some((s) => s.capabilities.reprojection === true);
  const outputFormats = new Set(matchingServices.flatMap((s) => s.capabilities.output_formats));
  const conceptId = collection.id;
  const shortName = collection.short_name;
  const services = matchingServices.map((s) => _.pick(s, ['name', 'capabilities']));
  const capabilities = {
    conceptId, shortName, variableSubset, bboxSubset, shapeSubset, temporalSubset,
    concatenate, reproject, outputFormats: Array.from(outputFormats), services, variables, capabilitiesVersion,
  };
  return capabilities;
}

/**
 * Resolves to a CollectionCapabilitiesV2 object detailing the harmony transformation capabilities
 * for the given collection in version 2 of the JSON format.
 *
 * @param collection - the CMR collection
 * @returns a promise resolving to the version 2 collection capabilities
 */
async function getCollectionCapabilitiesV2(collection: CmrCollection)
  : Promise<CollectionCapabilitiesV2> {
  const capabilitiesVersion = '2';
  const allServiceConfigs = addCollectionsToServicesByAssociation([collection]);
  const matchingServices = allServiceConfigs.filter((config) =>
    config.collections.map((c) => c.id).includes(collection.id));
  const variables = collection.variables.map((v) => getVariableV2(v));
  const variableSubset = variables.length > 0
    && matchingServices.some((s) => s.capabilities.subsetting.variable === true);
  const bboxSubset = matchingServices.some((s) => s.capabilities.subsetting.bbox === true);
  const shapeSubset = matchingServices.some((s) => s.capabilities.subsetting.shape === true);
  const temporalSubset = matchingServices.some((s) => s.capabilities.subsetting.temporal === true);
  const concatenate = matchingServices.some((s) => s.capabilities.concatenation === true);
  const reproject = matchingServices.some((s) => s.capabilities.reprojection === true);
  const outputFormats = new Set(matchingServices.flatMap((s) => s.capabilities.output_formats));
  const conceptId = collection.id;
  const shortName = collection.short_name;
  const services = matchingServices.map((s) => getServiceV2(s));
  const capabilities = {
    conceptId, shortName, variableSubset, bboxSubset, shapeSubset, temporalSubset,
    concatenate, reproject, outputFormats: Array.from(outputFormats), services, variables, capabilitiesVersion,
  };
  return capabilities;
}

/**
 * Returns the function to use to generate the JSON capabilities response
 *
 * @param version - the version of the capabilities JSON to return
 * @returns the capabilities function to use
 *
 * @throws RequestValidationError if the version is invalid
 */
function chooseCapabilitiesFunction(version: string): ((string) => Promise<CollectionCapabilities>) {
  if (version === '1') {
    return getCollectionCapabilitiesV1;
  } else if (version === '2') {
    return getCollectionCapabilitiesV2;
  }

  const message = `Invalid API version ${version}, supported versions: ${listToText(supportedApiVersions)}`;
  throw new RequestValidationError(message);
}

/**
 * Resolves to a CollectionCapabilities object detailing the harmony transformation capabilities
 * for the given collection and version of the API.
 *
 * @param collection - the CMR collection
 * @param version - the version of the capabilities JSON to return
 * @returns a promise resolving to the collection capabilities
 */
async function getCollectionCapabilities(collection: CmrCollection, version = currentApiVersion)
  : Promise<CollectionCapabilities> {
  const capabilitiesFn = chooseCapabilitiesFunction(version);
  return capabilitiesFn(collection);
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
  const query = keysToLowerCase(req.query);
  try {
    const capabilities = await getCollectionCapabilities(collection, query.version);
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
