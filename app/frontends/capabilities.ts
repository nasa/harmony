import HarmonyRequest from '../models/harmony-request';
import { Response, NextFunction } from 'express';
import { keysToLowerCase } from '../util/object';
import { RequestValidationError } from '../util/errors';
import { CmrCollection, getCollectionsByIds, getVariablesForCollection } from '../util/cmr';
import { addCollectionsToServicesByAssociation } from '../middleware/service-selection';
import _ from 'lodash';

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

/**
 * Return job state change links so that the user can pause, resume, cancel, etc., a job.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The job links (pause, resume, etc.)
 */
export async function getCollectionCapabilities(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  // try {
  const query = keysToLowerCase(req.query);
  const { collectionid } = query;
  if (!collectionid) {
    throw new RequestValidationError('Missing required parameter collectionId');
  } try {
    const collection = await loadCollectionInfo(collectionid, req.accessToken);
    const allServiceChainConfigs = addCollectionsToServicesByAssociation(req.collections);
    const matchingServiceChains = allServiceChainConfigs.filter((config) =>
      config.collections.map((c) => c.id).includes(collection.id));
    // const variables = collection.variables.map((v) => v.umm.Name);
    const variables = [];
    const variableSubset = variables.length > 0
      && matchingServiceChains.some((s) => s.capabilities.subsetting.variable === true);
    const bboxSubset = matchingServiceChains.some((s) => s.capabilities.subsetting.bbox === true);
    const shapefileSubset = matchingServiceChains.some((s) => s.capabilities.subsetting.shape === true);
    const concatenate = matchingServiceChains.some((s) => s.capabilities.concatenation === true);
    const reproject = matchingServiceChains.some((s) => s.capabilities.reprojection === true);
    const outputFormats = new Set(matchingServiceChains.flatMap((s) => s.capabilities.output_formats));
    const conceptId = collection.id;
    const shortName = collection.short_name;
    const serviceChains = matchingServiceChains.map((s) => _.pick(s, ['name', 'capabilities']));
    // const capabilities = { 'conceptId': collectionid };
    const capabilities = { conceptId, shortName, variableSubset, bboxSubset, shapefileSubset,
      concatenate, reproject, outputFormats: Array.from(outputFormats), serviceChains, variables,
    };
    res.send(capabilities);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}