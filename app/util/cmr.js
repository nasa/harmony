const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const fetch = require('node-fetch');
const querystring = require('querystring');
const readable = require('s3-readable');
const env = require('./env');
const { objectStoreForProtocol } = require('./object-store');

const cmrApi = axios.create({
  baseURL: 'https://cmr.uat.earthdata.nasa.gov/',
});

const POST_PATH = 'https://cmr.uat.earthdata.nasa.gov/search/granules.json';
// const POST_PATH = 'http://localhost:3003/granules.json';

const clientIdHeader = { 'Client-id': `${env.harmonyClientId}` };

const { s3 } = objectStoreForProtocol('s3');

/**
 * Combine headers into an options object to be passed with a CMR call
 *
 * @param {...object} headers One or more headers to be included in the options
 * @returns {object} An object with a single 'headers' key pointing to an object
 * containing the header key/value pairs
 * @private
 */
function makeOptions(...headers) {
  const keyVals = headers.reduce((options, header) => ({
    ...options, ...header,
  }));

  return { headers: keyVals };
}

/**
 * Create a token header for the given access token string
 *
 * @param {string} token The access token for the user
 * @returns {object} An object with an 'Echo-token' key and the token as the value,
 * or an empty object if the token is not set
 * @private
 */
function makeTokenHeader(token) {
  return token ? { 'Echo-token': `${token}:${process.env.OAUTH_CLIENT_ID}` } : {};
}

/**
 * Performs a CMR search at the given path with the given query string
 *
 * @param {string} path The absolute path on the CMR API to the resource being queried
 * @param {object} query The key/value pairs to send to the CMR query string
 * @param {string} token Access token for user request
 * @returns {Promise<object>} The CMR query result
 * @private
 */
async function cmrSearch(path, query, token) {
  const querystr = querystring.stringify(query);
  // Pass in a token to the CMR search if one is provided
  const options = makeOptions(clientIdHeader, makeTokenHeader(token));
  const response = await cmrApi.get([path, querystr].join('?'), options);
  // TODO: Error responses
  return response;
}

/**
 * Post a query to the CMR with the parameters in the given form
 *
 * @param {string} path The absolute path on the cmR API to the resource being queried
 * @param {object} form An object with keys and values representing the parameters for the query
 * @param {string} token Access token for the user
 * @returns {Promise<object>} The CMR query result
 * @private
 */
async function cmrPostSearch(path, form, token) {
  const options = makeOptions(clientIdHeader, makeTokenHeader(token));
  let tempFile;
  const formData = new FormData();
  Object.keys(form).forEach((key) => {
    const value = form[key];
    if (value) {
      if (key === 'shapefileInfo') {
        tempFile = value.path;
        // formData.append('shapefile', readable(s3).createReadStream({
        //   Bucket: value.bucket,
        //   Key: value.key,
        // }), {
        //   contentType: value.mimetype,
        // });
        formData.append('shapefile', fs.createReadStream(tempFile), { contentType: value.mimetype });
      } else {
        formData.append(key, value);
      }
    }
  });

  const formHeaders = formData.getHeaders();
  options.headers = { ...options.headers, formHeaders };

  let response;
  try {
    response = await fetch(POST_PATH, { method: 'POST', body: formData, headers: options.headers });
    response.data = await response.json();
  } catch (e) {
    console.log(e);
  }
  // TODO: handle errors

  // TODO: delete the temp file

  return response;
}

/**
 * Performs a CMR variables.json search with the given query string
 *
 * @param {object} query The key/value pairs to search
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrVariable>>} The variable search results
 * @private
 */
async function queryVariables(query, token) {
  const variablesResponse = await cmrSearch('/search/variables.json', query, token);
  return variablesResponse.data.items;
}

/**
 * Performs a CMR collections.json search with the given query string
 *
 * @param {object} query The key/value pairs to search
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrCollection>>} The collection search results
 * @private
 */
async function queryCollections(query, token) {
  const collectionsResponse = await cmrSearch('/search/collections.json', query, token);
  return collectionsResponse.data.feed.entry;
}

/**
 * Performs a CMR granules.json search with the given query string
 *
 * @param {object} query The key/value pairs to search
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrGranule>>} The granule search results
 * @private
 */
async function queryGranules(query, token) {
  // TODO: Paging / hits
  const granulesResponse = await cmrSearch('/search/granules.json', query, token);
  const cmrHits = parseInt(granulesResponse.headers['cmr-hits'], 10);
  return { hits: cmrHits, granules: granulesResponse.data.feed.entry };
}

/**
 * Performs a CMR granules.json search with the given form data
 *
 * @param {object} form The key/value pairs to search including a `shapefile` parameter pointing to a file
 * on the file system
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrGranule>>} The granule search results
 * @private
 */
async function queryGranuleUsingMultipartForm(form, token) {
  // TODO: Paging / hits
  const granuleResponse = await cmrPostSearch('/search/granules.json', form, token);
  const cmrHits = parseInt(granuleResponse.headers['cmr-hits'], 10);
  return { hits: cmrHits, granules: granuleResponse.data.feed.entry };
}

/**
 * Queries and returns the CMR JSON collections corresponding to the given CMR Collection IDs
 *
 * @param {Array<string>} ids The collection IDs to find
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrCollection>>} The collections with the given ids
 */
function getCollectionsByIds(ids, token) {
  return queryCollections({ concept_id: ids, page_size: 2000 }, token);
}

/**
 * Queries and returns the CMR JSON variables corresponding to the given CMR Variable IDs
 *
 * @param {Array<string>} ids The variable IDs to find
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrVariable>>} The variables with the given ids
 */
function getVariablesByIds(ids, token) {
  return queryVariables({ concept_id: ids, page_size: 2000 }, token);
}

/**
 * Queries and returns the CMR JSON variables that are associated with the given CMR JSON collection
 *
 * @param {CmrCollection} collection The collection whose variables should be returned
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrVariable>>} The variables associated with the input collection
 */
async function getVariablesForCollection(collection, token) {
  const varIds = collection.associations && collection.associations.variables;
  if (varIds) {
    return getVariablesByIds(varIds, token);
  }

  return [];
}

/**
 * Queries and returns the CMR JSON granules for the given collection ID with the given query params
 *
 * @param {string} collectionId The ID of the collection whose granules should be searched
 * @param {object} query The CMR granule query parameters to pass
 * @param {string} token Access token for user request
 * @param {number} [limit=10] The maximum number of granules to return
 * @returns {Promise<Array<CmrGranule>>} The granules associated with the input collection
 */
function queryGranulesForCollection(collectionId, query, token, limit = 10) {
  const baseQuery = {
    collection_concept_id: collectionId,
    page_size: limit,
  };
  return queryGranules(Object.assign(baseQuery, query), token);
}

/**
 * Queries the CMR using a multipart/form-data POST for granules with the given collection ID
 * using the given form object
 *
 * @param {string} collectionId The ID of the collection whose granules should be searched
 * @param {object} form An object containing the parameters and values for the CMR query
 * @param {string} token Access token for user request
 * @param {number} [limit=10] The maximum number of granules to return
 * @returns  {Promise<Array<CmrGranule>>} The granules associated with the input collection
 */
function queryGranulesForCollectionWithMultipartForm(collectionId, form, token, limit = 10) {
  const baseQuery = {
    collection_concept_id: collectionId,
    page_size: limit,
  };

  return queryGranuleUsingMultipartForm({ ...baseQuery, ...form }, token);
}

module.exports = {
  getCollectionsByIds,
  getVariablesByIds,
  getVariablesForCollection,
  queryGranulesForCollection,
  queryGranulesForCollectionWithMultipartForm,
  cmrApi, // Allow tests to override cmrApi
};
