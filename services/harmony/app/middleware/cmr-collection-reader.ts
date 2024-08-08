import { NextFunction } from 'express';
import { harmonyCollections } from '../models/services';
import { getVariablesForCollection, CmrCollection, getCollectionsByIds, getCollectionsByShortName, cmrApiConfig } from '../util/cmr';
import { ForbiddenError, NotFoundError, ServerError } from '../util/errors';
import HarmonyRequest from '../models/harmony-request';
import { listToText } from '@harmony/util/string';
import { EdlUserEulaInfo, verifyUserEula } from '../util/edl-api';

// CMR Collection IDs separated by delimiters of single "+" or single whitespace
// (some clients may translate + to space)
const CMR_CONCEPT_ID_URL_PATH_REGEX = /\/(?:C\d+-\w+[+\s])*(?:C\d+-\w+)+(?:\/|$)/g;

// Regex for any routes that we expect to begin with a CMR collection identifier
const COLLECTION_ROUTE_REGEX = /^(\/(?!docs).*\/)(wms|ogc-api-coverages|cube|area|position)/;

/**
 * Loads the variables for the given collection from the CMR and sets the collection's
 * "variables" attribute to the result
 *
 * @param collection - The collection whose variables should be loaded
 * @param token - Access token for user request
 * @returns Resolves when the loading completes
 */
async function loadVariablesForCollection(collection: CmrCollection, token: string): Promise<void> {
  const c = collection; // We are mutating collection
  c.variables = await getVariablesForCollection(collection, token);
}

/**
 * Check that the user has accepted any EULAs that are attached to the collections
 * in the request.
 * @param collections - array of CMR collections
 * @param req - the client request
 * @throws ServerError, ForbiddenError, NotFoundError
 */
async function verifyEulaAcceptance(collections: CmrCollection[], req: HarmonyRequest): Promise<void> {
  const acceptEulaUrls = [];
  for (const collection of collections) {
    if (collection.eula_identifiers) {
      for (const eulaId of collection.eula_identifiers) {
        const eulaInfo: EdlUserEulaInfo = await verifyUserEula(req.user, eulaId, req.context.logger);
        if (eulaInfo.statusCode == 404 && eulaInfo.acceptEulaUrl) { // EULA wasn't accepted
          acceptEulaUrls.push(eulaInfo.acceptEulaUrl);
        } else if (eulaInfo.statusCode == 404) {
          req.context.logger.error(`EULA (${eulaId}) verfification failed with statusCode 404. Error: ${eulaInfo.error}`);
          throw new NotFoundError(`EULA ${eulaId} could not be found.`);
        } else if (eulaInfo.statusCode !== 200) {
          req.context.logger.error(`EULA (${eulaId}) verfification failed. Error: ${eulaInfo.error}`);
          throw new ServerError(`EULA (${eulaId}) verfification failed unexpectedly.`);
        }
      }
    }
  }
  if (acceptEulaUrls.length > 0) {
    throw new ForbiddenError('You may access the requested data by resubmitting your request ' +
      `after accepting the following EULA(s): ${acceptEulaUrls.join(', ')}.`);
  }
}

/**
 * Express.js middleware that reads a list of slash-separated CMR Collection IDs
 * from a URL and adds two attributes to the req object:
 *
 *   req.collectionIds: An array of the resolved collection IDs
 *   req.collections: An array of the CMR (JSON) collections, each with a "variables" attribute
 *      containing the Collection's UMM-Var variables
 *
 * After resolving the above, req.url will be altered to remove the collections as follows:
 *
 * Example req.url: /C00001-MYPROV/C00002-MYPROV/some-path
 * Note: multi-line code comments aren't supported in TSDocs - https://github.com/microsoft/tsdoc/issues/166
 * @example
 * \{
 *     ...,
 *     collectionIds: ["C00001-MYPROV", "C00002-MYPROV"],
 *     collections: [\{...\}, \{...\}],
 *     url: "/some-path"
 * \}
 *
 * If no collection IDs are present at the front of the path, does not alter req.url and sets
 * req.collectionIds and req.collections to empty arrays.
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
async function cmrCollectionReader(req: HarmonyRequest, res, next: NextFunction): Promise<void> {
  try {
    const collectionMatch = req.url.match(CMR_CONCEPT_ID_URL_PATH_REGEX);
    if (collectionMatch) {
      const collectionIdStr = collectionMatch[0].replace(/\/$/, '').substr(1, collectionMatch[0].length - 1);
      const collectionIds = collectionIdStr.split(/[+\s]/g);
      req.collectionIds = collectionIds;
      req.context.logger.info(`Matched CMR concept IDs: ${collectionIds}`);

      req.collections = await getCollectionsByIds(collectionIds, req.accessToken);
      const { collections } = req;

      await verifyEulaAcceptance(collections, req);

      // Could not find a requested collection
      if (collections.length === 0) {
        const message = `${collectionIdStr} must be a collection short name or CMR collection`
        + ' identifier, but we could not find a matching collection. Please make sure the collection'
        + ' is correct and that you have access to it.';
        throw new NotFoundError(message);
      } else if (collections.length !== collectionIds.length) {
        const foundIds = collections.map((c) => c.id);
        const missingIds = collectionIds.filter((c) => !foundIds.includes(c));
        const s = missingIds.length > 1 ? 's' : '';
        const message = `The collection${s} ${listToText(missingIds)} could not be found. Please make`
        + ' sure the collection identifiers are correct and that you have access to each collection.';
        throw new NotFoundError(message);
      }

      const promises = [];
      for (const collection of collections) {
        promises.push(loadVariablesForCollection(collection, req.accessToken));
      }
      await Promise.all(promises);
    } else {
      // The request used a short name
      const shortNameMatch = req.url.match(COLLECTION_ROUTE_REGEX);
      if (shortNameMatch) {
        const shortNamePart = shortNameMatch[1].substr(1, shortNameMatch[1].length - 2);
        // fix the short name for ogc EDR requests
        const shortName = shortNamePart.replace(/^ogc-api-edr\/.*\/collections\//, '');
        const collections = await getCollectionsByShortName(shortName, req.accessToken);
        let pickedCollection = collections[0];
        if (collections.length > 1) {
          // If there are multiple collections matching prefer a collection that is configured
          // for use in harmony
          const harmonyCollection = collections.find((c) => harmonyCollections(collections).includes(c.id));
          pickedCollection = harmonyCollection || pickedCollection;
        }
        if (pickedCollection) {
          await verifyEulaAcceptance([pickedCollection], req);

          req.collections = [pickedCollection];
          req.collectionIds = [pickedCollection.id];
          await loadVariablesForCollection(pickedCollection, req.accessToken);
          if (collections.length > 1) {
            const collectionLandingPage = `${cmrApiConfig.baseURL}/concepts/${pickedCollection.id}`;
            req.context.messages.push(`There were ${collections.length} collections that matched the`
            + ` provided short name ${shortName}. See ${collectionLandingPage} for details on the`
            + ' selected collection. The version ID for the selected collection is '
            + `${pickedCollection.version_id}. To use a different collection submit a new request`
            + ' specifying the desired CMR concept ID instead of the collection short name.');
          }
        } else {
          const message = `${shortName} must be a collection short name or CMR collection identifier,`
            + ' but we could not find a matching collection. Please make sure the collection is'
            + ' correct and that you have access to it.';
          throw new NotFoundError(message);
        }
      }
    }
    next();
  } catch (error) {
    req.collectionIds = [];
    req.collections = [];
    next(error);
  }
}

cmrCollectionReader.collectionRegex = COLLECTION_ROUTE_REGEX;

export = cmrCollectionReader;
