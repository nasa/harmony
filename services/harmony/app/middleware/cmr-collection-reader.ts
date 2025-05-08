import { NextFunction } from 'express';

import { listToText } from '@harmony/util/string';

import HarmonyRequest from '../models/harmony-request';
import RequestContext from '../models/request-context';
import { harmonyCollections } from '../models/services';
import {
  cmrApiConfig, CmrCollection, getCollectionsByIds, getCollectionsByShortName,
  getVariablesForCollection, getVisualizationsForCollection, getVisualizationsForVariable,
} from '../util/cmr';
import { EdlUserEulaInfo, verifyUserEula } from '../util/edl-api';
import env from '../util/env';
import { ForbiddenError, NotFoundError, ServerError } from '../util/errors';

// CMR Collection IDs separated by delimiters of single "+" or single whitespace
// (some clients may translate + to space)
const CMR_CONCEPT_ID_URL_PATH_REGEX = /\/(?:C\d+-\w+[+\s])*(?:C\d+-\w+)+(?:\/|$)/g;

// Regex for any routes that we expect to begin with a CMR collection identifier or /ogc-api-edr/
const COLLECTION_ROUTE_REGEX = /^((\/(?!docs).*\/)(wms|ogc-api-coverages)|\/ogc-api-edr\/)/;

// Regex for retrieving collection identifier of EDR request
const EDR_COLLECTION_ROUTE_REGEX = /^\/ogc-api-edr\/.*\/collections\/(.*)\//;

/**
 * Loads the variables for the given collection from the CMR and sets the collection's
 * "variables" attribute to the result
 *
 * @param context - The context for the user's request
 * @param collection - The collection whose variables should be loaded
 * @param token - Access token for user request
 * @returns Resolves when the loading completes
 */
async function loadVariablesForCollection(context: RequestContext, collection: CmrCollection, token: string): Promise<void> {
  collection.variables = await getVariablesForCollection(context, collection, token);
}

/**
 * Loads the visualizations for the given collection from the CMR and sets the collection's
 * "visualizations" attribute to the result. First checks for visualizations for any associated
 * variables and uses those. If none are available, load any visualizations directly
 * associated with this collections.
 *
 * @param context - The context for the user's request
 * @param collection - The collection whose visualizations should be loaded
 * @param token - Access token for user request
 * @returns Resolves when the loading completes
 */
async function loadVisualizationsForCollection(context: RequestContext, collection: CmrCollection, token: string): Promise<void> {
  const visPromises = [];
  if (collection.variables && collection.variables.length > 0) {
    for (const variable of collection.variables) {
      visPromises.push(getVisualizationsForVariable(context, variable, token));
    }
  }
  const visualizations = [].concat(await Promise.all(visPromises)).flat();
  if (visualizations.length > 0) {
    collection.visualizations = visualizations;
  } else {
    collection.visualizations = await getVisualizationsForCollection(context, collection, token);
  }
}

/**
 * Check that the user has accepted any EULAs that are attached to the collections
 * in the request.
 * @param collections - array of CMR collections
 * @param req - the client request
 * @throws ServerError, ForbiddenError, NotFoundError
 */
async function verifyEulaAcceptance(collections: CmrCollection[], req: HarmonyRequest): Promise<void> {
  if (env.useEdlClientApp) {
    const acceptEulaUrls = [];
    for (const collection of collections) {
      if (collection.eula_identifiers) {
        for (const eulaId of collection.eula_identifiers) {
          const eulaInfo: EdlUserEulaInfo = await verifyUserEula(req.context, req.user, eulaId);
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
}

/**
 * Express.js middleware that reads a list of slash-separated CMR Collection IDs
 * from a URL and adds two attributes to the request context:
 *
 *   req.context.collectionIds: An array of the resolved collection IDs
 *   req.context.collections: An array of the CMR (JSON) collections, each with a "variables" attribute
 *      containing the Collection's UMM-Var variables and a "visualizations" attribute
 *      containing UMM-Vis visualizations associated with the collection or the collection's variables
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
 * req.context.collectionIds and req.context.collections to empty arrays.
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
      req.context.collectionIds = collectionIds;
      req.context.logger.info(`Matched CMR concept IDs: ${collectionIds}`);

      req.context.collections = await getCollectionsByIds(req.context, collectionIds, req.accessToken);
      const { collections } = req.context;

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
        promises.push(loadVariablesForCollection(req.context, collection, req.accessToken));
      }
      await Promise.all(promises);
      // must wait for the above promises so that collections have their associated variables
      // before we look for visualizations
      promises.length = 0; // clear the array
      for (const collection of collections) {
        promises.push(loadVisualizationsForCollection(req.context, collection, req.accessToken));
      }
      await Promise.all(promises);

    } else {
      // The request used a short name
      const shortNameMatch = req.url.match(COLLECTION_ROUTE_REGEX);
      if (shortNameMatch) {
        let shortName = '';
        if (shortNameMatch[1] == '/ogc-api-edr/') {
          const edrMatch = req.url.match(EDR_COLLECTION_ROUTE_REGEX);
          shortName = edrMatch[1];
        } else {
          shortName = shortNameMatch[2].substr(1, shortNameMatch[2].length - 2);
        }

        const collections = await getCollectionsByShortName(req.context, shortName, req.accessToken);
        let pickedCollection = collections[0];
        if (collections.length > 1) {
          // If there are multiple collections matching prefer a collection that is configured
          // for use in harmony
          const harmonyCollection = collections.find((c) => harmonyCollections(collections).includes(c.id));
          pickedCollection = harmonyCollection || pickedCollection;
        }
        if (pickedCollection) {
          await verifyEulaAcceptance([pickedCollection], req);

          req.context.collections = [pickedCollection];
          req.context.collectionIds = [pickedCollection.id];
          await loadVariablesForCollection(req.context, pickedCollection, req.accessToken);
          await loadVisualizationsForCollection(req.context, pickedCollection, req.accessToken);
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
    req.context.collectionIds = [];
    req.context.collections = [];
    next(error);
  }
}

cmrCollectionReader.collectionRegex = COLLECTION_ROUTE_REGEX;

export = cmrCollectionReader;
