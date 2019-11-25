const cmrutil = require('../util/cmr');
const { listToText } = require('../util/string');
const { NotFoundError } = require('../util/errors');

// CMR Collection IDs separated by delimiters of single "+" or single whitespace
// (some clients may translate + to space)
const COLLECTION_URL_PATH_REGEX = /^\/(?:C\d+-\w+[+\s])*(?:C\d+-\w+)+\//g;

/**
 * Loads the variables for the given collection from the CMR and sets the collection's
 * "variables" attribute to the result
 *
 * @param {CmrCollection} collection The collection whose variables should be loaded
 * @param {String} token Access token for user request
 * @returns {Promise<void>} Resolves when the loading completes
 */
async function loadVariablesForCollection(collection, token) {
  const c = collection; // We are mutating collection
  c.variables = await cmrutil.getVariablesForCollection(collection, token);
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
 * Resulting req object:
 *   {
 *     ...,
 *     collectionIds: ["C00001-MYPROV", "C00002-MYPROV"],
 *     collections: [{...}, {...}],
 *     url: "/some-path"
 *   }
 *
 * If no collection IDs are present at the front of the path, does not alter req.url and sets
 * req.collectionIds and req.collections to empty arrays.
 *
 * @param {http.IncomingMessage} req The client request
 * @param {http.ServerResponse} res The client response
 * @param {function} next The next function in the middleware chain
 * @returns {void}
 */
async function cmrCollectionReader(req, res, next) {
  try {
    const collectionMatch = req.url.match(COLLECTION_URL_PATH_REGEX);
    if (collectionMatch) {
      const collectionIdStr = collectionMatch[0].substr(1, collectionMatch[0].length - 2);
      const collectionIds = collectionIdStr.split(/[+\s]/g);
      req.collectionIds = collectionIds;
      req.logger.info(`Matched collections: ${collectionIds}`);

      req.collections = await cmrutil.getCollectionsByIds(collectionIds, req.accessToken);
      const { collections } = req;

      // Could not find a requested collection
      if (collections.length !== collectionIds.length) {
        const foundIds = collections.map((c) => c.id);
        const missingIds = collectionIds.filter((c) => !foundIds.includes(c));
        const s = missingIds.length > 1 ? 's' : '';
        const message = `The collection${s} with ID${s} ${listToText(missingIds)} could not be found`;
        throw new NotFoundError(message);
      }

      const promises = [];
      for (const collection of collections) {
        promises.push(loadVariablesForCollection(collection, req.accessToken));
      }
      await Promise.all(promises);
    } else {
      req.collectionIds = [];
      req.collections = [];
    }
    next();
  } catch (error) {
    req.collectionIds = [];
    req.collections = [];
    next(error);
  }
}

cmrCollectionReader.collectionRegex = COLLECTION_URL_PATH_REGEX;

module.exports = cmrCollectionReader;
