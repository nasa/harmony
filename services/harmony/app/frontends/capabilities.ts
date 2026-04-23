import { NextFunction, Response } from 'express';
import _ from 'lodash';

import { listToText } from '@harmony/util/string';

import { addCollectionsToServicesByAssociation } from '../middleware/service-selection';
import HarmonyRequest from '../models/harmony-request';
import RequestContext from '../models/request-context';
import { harmonyCollections } from '../models/services';
import { ServiceCapabilities, ServiceConfig } from '../models/services/base-service';
import {
  CmrCollection, CmrUmmService, CmrUmmVariable, getCollectionsByIds, getCollectionsByShortName,
  getServicesByIds, getVariablesForCollection,
} from '../util/cmr';
import { NotFoundError, RequestValidationError } from '../util/errors';
import { keysToLowerCase } from '../util/object';

export const stableApiVersion = '2';
const supportedApiVersions = ['1', '2', '3-alpha'];

interface Projection {
  crs: string;
  name: string;
}
interface ServiceV2 {
  name: string;
  href: string;
  capabilities: ServiceCapabilities;
}

interface ServiceV3 {
  name: string;
  href: string;
  capabilities: ServiceCapabilitiesV3;
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

interface ServiceCapabilitiesV3 {
  subsetting: {
    bbox: boolean;
    dimension: boolean;
    shape: boolean;
    temporal: boolean;
    variable: boolean;
  },
  reprojection: {
    supported: boolean;
    supportedProjections: Projection[],
    interpolationMethods: string[],
  },
  averaging: {
    time: boolean;
    area: boolean;
  }
  concatenation: boolean;
  outputFormats: string[];
}

interface CollectionCapabilitiesV3 {
  conceptId: string;
  shortName: string;
  summary: ServiceCapabilitiesV3;
  services: ServiceV3[];
  variables: VariableV2[];
  capabilitiesVersion: string;
}


type CollectionCapabilities = CollectionCapabilitiesV1 | CollectionCapabilitiesV2 | CollectionCapabilitiesV3;

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
 * Creates a map of concept ID to UMM-S record
 * @param ummRecords - an array of UMM-S records
 */
function createUmmRecordsMap(ummRecords: CmrUmmService[]): { [key: string]: CmrUmmService } {
  return ummRecords.reduce((allRecords, ummRecord) => {
    const conceptId = ummRecord.meta['concept-id'];
    allRecords[conceptId] = ummRecord;
    return allRecords;
  }, {});
}

/**
 * Returns the collection capabilities format from the provided harmony services.yml
 * capabilities configuration for a service chain.
 *
 * @param harmonyConfigCapabilities - the capabilities section of the harmony services.yml
 * configuration for a service
 * @param supportedProjections - a list of supported projections for the service chain
 * @param interpolationMethods - a list of supported interpolation methods for resampling
 * peformed as part of reprojection.
 *
 * @returns the capabilities in the format for the collection capabilities endpoint
 */
function convertServicesYamlConfigToCapabilities(
  harmonyConfigCapabilities: ServiceCapabilities,
  supportedProjections: Projection[],
  interpolationMethods: string[],
): ServiceCapabilitiesV3 {
  const capabilities = {
    subsetting: {
      bbox: harmonyConfigCapabilities.subsetting.bbox || false,
      dimension: harmonyConfigCapabilities.subsetting.dimension || false,
      shape: harmonyConfigCapabilities.subsetting.shape || false,
      temporal: harmonyConfigCapabilities.subsetting.temporal || false,
      variable: harmonyConfigCapabilities.subsetting.variable || false,
    },
    reprojection: {
      supported: harmonyConfigCapabilities.reprojection || false,
      supportedProjections,
      interpolationMethods,
    },
    averaging: {
      time: harmonyConfigCapabilities.averaging?.time || false,
      area: harmonyConfigCapabilities.averaging?.area || false,
    },
    concatenation: harmonyConfigCapabilities.concatenation || false,
    outputFormats: harmonyConfigCapabilities.output_formats,
  };
  return capabilities;
}

/**
 * Returns the service representation in capabilities version 3 format including
 * supported reprojections from the UMM-S record. Harmony services that support
 * reprojection must include the ProjectionAuthority field in order to be included
 * as supported output projections.
 *
 * @param variable - the services config object
 * @returns the service representation in capabilities version 2 format
 */
async function getServicesV3(
  context: RequestContext,
  serviceConfigs: ServiceConfig<unknown>[],
): Promise<ServiceV3[]> {
  const ummConceptIds = serviceConfigs.flatMap((config) =>
    config.umm_s ? [config.umm_s] : [],
  );
  const v3Services: ServiceV3[] = [];
  let ummRecordsMap = {};
  if (ummConceptIds.length > 0) {
    const ummRecords = await getServicesByIds(context, ummConceptIds, null);
    ummRecordsMap = createUmmRecordsMap(ummRecords);
  }

  for (const harmonyConfig of serviceConfigs) {
    const supportedProjections = [];
    let interpolationMethods = [];
    let href;
    if (harmonyConfig.umm_s) {
      href = `${process.env.CMR_ENDPOINT}/search/concepts/${harmonyConfig.umm_s}`;
      const ummRecord = ummRecordsMap[harmonyConfig.umm_s];
      if (!ummRecord) {
        context.logger.warn(`${harmonyConfig.umm_s} service record was not returned by the CMR`);
      } else {
        const projections = ummRecord.umm.ServiceOptions?.SupportedOutputProjections || [];
        for (const projection of projections) {
          const { ProjectionName, ProjectionAuthority } = projection;
          // Only return projections with a ProjectionAuthority which should be passed
          // in a harmony request as the outputCRS parameter.
          if (ProjectionAuthority) {
            supportedProjections.push({
              name: ProjectionName, crs: ProjectionAuthority,
            });
          }
        }
        interpolationMethods = ummRecord.umm.ServiceOptions?.InterpolationTypes || [];
      }
    }

    const serviceCapabilities = convertServicesYamlConfigToCapabilities(
      harmonyConfig.capabilities, supportedProjections, interpolationMethods,
    );

    v3Services.push({
      name: harmonyConfig.name,
      href,
      capabilities: serviceCapabilities,
    });
  }

  return v3Services;
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
 * Returns the supported output projections from all services. Note that it's possible
 * different services could have different names for the same crs field. In that case
 * we just choose the first name.
 *
 * @param services - a list of all of the services in ServiceV3 format
 * @returns the supported output projections in capabilities version 3 format
 */
function getProjections(services: ServiceV3[]): Projection[] {
  const byCrs = new Map<string, Projection>();
  for (const service of services) {
    for (const projection of service.capabilities.reprojection.supportedProjections) {
      if (!byCrs.has(projection.crs)) {
        byCrs.set(projection.crs, projection);
      }
    }
  }
  return Array.from(byCrs.values());
}

/**
 * Returns the supported output projections from all services.
 *
 * @param services - a list of all of the services in ServiceV3 format
 * @returns the supported output projections in capabilities version 3 format
 */
function getInterpolationMethods(services: ServiceV3[]): Set<string> {

  const interpolationMethods = new Set<string>();
  for (const service of services) {
    for (const interpolationMethod of service.capabilities.reprojection.interpolationMethods) {
      interpolationMethods.add(interpolationMethod);
    }
  }

  return interpolationMethods;
}


/**
 * Resolves to a CollectionCapabilitiesV1 object detailing the harmony transformation capabilities
 * for the given collection in version 1 of the JSON format.
 *
 * @param context - the request context
 * @param collection - the CMR collection
 * @returns a promise resolving to the version 1 collection capabilities
 */
async function getCollectionCapabilitiesV1(
  _context: RequestContext,
  collection: CmrCollection,
) : Promise<CollectionCapabilitiesV1> {
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
 * @param context - the request context
 * @param collection - the CMR collection
 * @returns a promise resolving to the version 2 collection capabilities
 */
async function getCollectionCapabilitiesV2(
  _context: RequestContext,
  collection: CmrCollection,
) : Promise<CollectionCapabilitiesV2> {
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
 * Resolves to a CollectionCapabilitiesV3 object detailing the harmony transformation capabilities
 * for the given collection in version 3 of the JSON format.
 *
 * @param context - the request context
 * @param collection - the CMR collection
 * @returns a promise resolving to the version 3 collection capabilities
 */
async function getCollectionCapabilitiesV3(
  context: RequestContext,
  collection: CmrCollection,
): Promise<CollectionCapabilitiesV3> {
  const capabilitiesVersion = '3-alpha';
  const allServiceConfigs = addCollectionsToServicesByAssociation([collection]);
  const matchingServices = allServiceConfigs.filter((config) =>
    config.collections.map((c) => c.id).includes(collection.id));
  const variables = collection.variables.map((v) => getVariableV2(v));
  const variableSubset = variables.length > 0
    && matchingServices.some((s) => s.capabilities.subsetting.variable === true);
  const bboxSubset = matchingServices.some((s) => s.capabilities.subsetting.bbox === true);
  const shapeSubset = matchingServices.some((s) => s.capabilities.subsetting.shape === true);
  const temporalSubset = matchingServices.some((s) => s.capabilities.subsetting.temporal === true);
  const dimensionSubset = matchingServices.some((s) => s.capabilities.subsetting.dimension === true);
  const concatenationSupported = matchingServices.some((s) => s.capabilities.concatenation === true);
  const reprojectionSupported = matchingServices.some((s) => s.capabilities.reprojection === true);
  const timeAveraging = matchingServices.some((s) => s.capabilities.averaging?.time === true);
  const areaAveraging = matchingServices.some((s) => s.capabilities.averaging?.area === true);
  const outputFormats = new Set(matchingServices.flatMap((s) => s.capabilities.output_formats));
  const conceptId = collection.id;
  const shortName = collection.short_name;
  const services = await getServicesV3(context, matchingServices);
  const projections = getProjections(services);
  const interpolationMethods = getInterpolationMethods(services);

  const summary = {
    subsetting: {
      bbox: bboxSubset,
      dimension: dimensionSubset,
      shape: shapeSubset,
      temporal: temporalSubset,
      variable: variableSubset,
    },
    reprojection: {
      supported: reprojectionSupported,
      supportedProjections: projections,
      interpolationMethods: Array.from(interpolationMethods),
    },
    averaging: {
      time: timeAveraging,
      area: areaAveraging,
    },
    concatenation: concatenationSupported,
    outputFormats: Array.from(outputFormats),
  };

  const capabilities = {
    conceptId, shortName, summary,
    services, variables, capabilitiesVersion,
  };

  return capabilities;
}

/**
 * Returns the function to use to generate the JSON capabilities response
 *
 * @param context - the request context
 * @param version - the version of the capabilities JSON to return
 * @returns the capabilities function to use
 *
 * @throws RequestValidationError if the version is invalid
 */
function chooseCapabilitiesFunction(version: string)
  : ((context, string) => Promise<CollectionCapabilities>) {
  if (version === '1') {
    return getCollectionCapabilitiesV1;
  } else if (version === '2') {
    return getCollectionCapabilitiesV2;
  } else if (version === '3' || version === '3-alpha') {
    return getCollectionCapabilitiesV3;
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
async function getCollectionCapabilities(
  context: RequestContext,
  collection: CmrCollection,
  version = stableApiVersion,
) : Promise<CollectionCapabilities> {
  const capabilitiesFn = chooseCapabilitiesFunction(version);
  return capabilitiesFn(context, collection);
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
    const capabilities = await getCollectionCapabilities(
      req.context, collection, query.version,
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
export async function getCollectionCapabilitiesHtml(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const collection = await loadCollectionInfo(req);
  try {
    const capabilities = await getCollectionCapabilities(req.context, collection);
    res.render('capabilities/index', { capabilities });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}
