const axios = require('axios');
const querystring = require('querystring');

const cmrApi = axios.create({
  baseURL: 'https://cmr.uat.earthdata.nasa.gov/',
});

/**
 * Performs a CMR search at the given path with the given query string
 *
 * @param {string} path The absolute path on the CMR API to the resource being queried
 * @param {object} query The key/value pairs to send to the CMR query string
 * @returns {Promise<object>} The CMR query result
 * @private
 */
async function cmrSearch(path, query) {
  const querystr = querystring.stringify(query);
  const response = await cmrApi.get([path, querystr].join('?'));
  // TODO: Error responses
  return response.data;
}

/**
 * Performs a CMR variables.json search with the given query string
 *
 * @param {object} query The key/value pairs to search
 * @returns {Promise<Array<CmrVariable>>} The variable search results
 * @private
 */
async function queryVariables(query) {
  const variablesResponse = await cmrSearch('/search/variables.json', query);
  return variablesResponse.items;
}

/**
 * Performs a CMR collections.json search with the given query string
 *
 * @param {object} query The key/value pairs to search
 * @returns {Promise<Array<CmrCollection>>} The collection search results
 * @private
 */
async function queryCollections(query) {
  const collectionsResponse = await cmrSearch('/search/collections.json', query);
  return collectionsResponse.feed.entry;
}

/**
 * Performs a CMR granules.json search with the given query string
 *
 * @param {object} query The key/value pairs to search
 * @returns {Promise<Array<CmrGranule>>} The granule search results
 * @private
 */
async function queryGranules(query) {
  // TODO: Paging / hits
  const granulesResponse = await cmrSearch('/search/granules.json', query);
  return granulesResponse.feed.entry;
}

/**
 * Queries and returns the CMR JSON collections corresponding to the given CMR Collection IDs
 *
 * @param {Array<string>} ids The collection IDs to find
 * @returns {Promise<Array<CmrCollection>>} The collections with the given ids
 */
function getCollectionsByIds(ids) {
  return queryCollections({ concept_id: ids, page_size: 2000 });
}

/**
 * Queries and returns the CMR JSON variables corresponding to the given CMR Variable IDs
 *
 * @param {Array<string>} ids The variable IDs to find
 * @returns {Promise<Array<CmrVariable>>} The variables with the given ids
 */
function getVariablesByIds(ids) {
  return queryVariables({ concept_id: ids, page_size: 2000 });
}

/**
 * Queries and returns the CMR JSON variables that are associated with the given CMR JSON collection
 *
 * @param {CmrCollection} collection The collection whose variables should be returned
 * @returns {Promise<Array<CmrVariable>>} The variables associated with the input collection
 */
async function getVariablesForCollection(collection) {
  const varIds = collection.associations && collection.associations.variables;
  if (varIds) {
    return getVariablesByIds(varIds);
  }

  return [];
}

/**
 * Queries and returns the CMR JSON granules for the given collection ID with the given query params
 *
 * @param {string} collectionId The ID of the collection whose granules should be searched
 * @param {object} query The CMR granule query parameters to pass
 * @param {number} limit The maximum number of granules to return
 * @returns {Promise<Array<CmrVariable>>} The variables associated with the input collection
 */
function queryGranulesForCollection(collectionId, query, limit = 10) {
  const baseQuery = {
    collection_concept_id: collectionId,
    page_size: limit,
  };
  return queryGranules(Object.assign(baseQuery, query));
}

module.exports = {
  getCollectionsByIds,
  getVariablesByIds,
  getVariablesForCollection,
  queryGranulesForCollection,
};
