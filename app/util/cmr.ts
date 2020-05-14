import FormData from 'form-data';
import fs from 'fs';
import { get } from 'lodash';
import fetch from 'node-fetch';
import * as querystring from 'querystring';
import * as util from 'util';
import { CmrError } from './errors';
import { objectStoreForProtocol } from './object-store';

import env = require('./env');
import logger = require('./log');

const unlink = util.promisify(fs.unlink);

const clientIdHeader = {
  'Client-id': `${env.harmonyClientId}`,
};

// Exported to allow tests to override cmrApiConfig
export const cmrApiConfig = {
  baseURL: env.CMR_URL || 'https://cmr.uat.earthdata.nasa.gov',
  useToken: true,
};

const acceptJsonHeader = {
  Accept: 'application/json',
};

/**
 * Create a token header for the given access token string
 *
 * @param {string} token The access token for the user
 * @returns {object} An object with an 'Echo-token' key and the token as the value,
 * or an empty object if the token is not set
 * @private
 */
function _makeTokenHeader(token) {
  return cmrApiConfig.useToken && token ? {
    'Echo-token': `${token}:${process.env.OAUTH_CLIENT_ID}`,
  } : {};
}

/**
 * Handle any errors in the CMR response
 *
 * @param {Object} response The response from the CMR
 * @returns {void}
 * @throws {CmrError} if the CMR response indicates an error
 * @private
 */
function _handleCmrErrors(response) {
  const { status } = response;
  if (status >= 500) {
    logger.error(`CMR call failed with statue '${status}'`);
    throw new CmrError(503, 'Service unavailable');
  } else if (status >= 400) {
    // pass on errors from the CMR
    const message = get(response, ['data', 'errors', 0])
    || `'${response.statusText}'`;
    logger.error(`CMR returned status '${status}' with message '${message}'`);
    throw new CmrError(status, message);
  }
}

/**
 * Performs a CMR search at the given path with the given query string
 *
 * @param path - The absolute path on the CMR API to the resource being queried
 * @param query - The key/value pairs to send to the CMR query string
 * @param token - Access token for user request
 * @param extraHeaders - Additional headers to pass with the request
 * @returns The CMR query result
 */
export async function cmrSearchBase(path, query, token, extraHeaders = {}) {
  const querystr = querystring.stringify(query);
  const headers = {
    ...clientIdHeader,
    ..._makeTokenHeader(token),
    ...acceptJsonHeader,
    ...extraHeaders,
  };
  const response: any = await fetch(`${cmrApiConfig.baseURL}${path}?${querystr}`,
    {
      method: 'GET',
      headers,
    });
  response.data = await response.json();
  return response;
}

/**
 * Performs a CMR search at the given path with the given query string. This function wraps
 * `CmrSearchBase` to make it easier to test.
 *
 * @param {string} path The absolute path on the CMR API to the resource being queried
 * @param {object} query The key/value pairs to send to the CMR query string
 * @param {string} token Access token for user request
 * @returns {Promise<object>} The CMR query result
 * @throws {CmrError} If the CMR returns an error status
 * @private
 */
async function _cmrSearch(path, query, token) {
  const response = await cmrSearchBase(path, query, token);
  _handleCmrErrors(response);
  return response;
}

/**
 * Use `fetch` to POST multipart/form-data. This code has been pulled into a separate
 * function simply as a work-around to a bug in `node replay` that breaks shapefile
 * uploads to the CMR. By pulling it into a separate function we can stub it to have
 * the necessary response.
 *
 * @param {string} path The URL path
 * @param {*} formData A FormData object to be POST'd
 * @param {object} headers The headers to be sent with the POST
 * @returns {Response} A SuperAgent Response object
 */
export async function fetchPost(path, formData, headers) {
  const response: any = await fetch(`${cmrApiConfig.baseURL}${path}`, {
    method: 'POST',
    body: formData,
    headers,
  });
  response.data = await response.json();
  return response;
}

/**
 * Process a GeoJSON entry by downloading the file from S3 and adding an entry for it in
 * a mulitpart/form-data object to be uploaded to the CMR.
 *
 * @param {string} geoJsonUrl The location of the shapefile
 * @param {Object} formData the Form data
 * @returns {Promise<File>} The a promise for a temporary file containing the shapefile
 */
async function processGeoJson(geoJsonUrl, formData) {
  const tempFile = await objectStoreForProtocol(geoJsonUrl).downloadFile(geoJsonUrl);
  formData.append('shapefile', fs.createReadStream(tempFile), {
    contentType: 'application/geo+json',
  });
  return tempFile;
}

/**
 * Post a query to the CMR with the parameters in the given form
 *
 * @param {string} path The absolute path on the CMR API to the resource being queried
 * @param {object} form An object with keys and values representing the parameters for the query
 * @param {string} token Access token for the user
 * @returns {Promise<object>} The CMR query result
 */
export async function cmrPostSearchBase(path, form, token) {
  const formData = new FormData();
  let shapefile = null;
  await Promise.all(Object.keys(form).map(async (key) => {
    const value = form[key];
    if (value) {
      if (key === 'geojson') {
        shapefile = await processGeoJson(value, formData);
      } else if (Array.isArray(value)) {
        value.forEach((v) => {
          formData.append(key, v);
        });
      } else {
        formData.append(key, value);
      }
    }
  }));
  const headers = {
    ...clientIdHeader,
    ..._makeTokenHeader(token),
    ...acceptJsonHeader,
    ...formData.getHeaders(),
  };

  try {
    return module.exports.fetchPost(path, formData, headers);
  } finally {
    if (shapefile) {
      unlink(shapefile);
    }
  }
}

/**
 * Post a query to the CMR with the parameters in the given form. This function wraps
 * `CmrPostSearchBase` to make it easier to test.
 *
 * @param {string} path The absolute path on the cmR API to the resource being queried
 * @param {object} form An object with keys and values representing the parameters for the query
 * @param {string} token Access token for the user
 * @returns {Promise<object>} The CMR query result
 * @throws {CmrError} If the CMR returns an error status
 * @private
 */
async function _cmrPostSearch(path, form, token) {
  const response = await module.exports.cmrPostSearchBase(path, form, token);
  _handleCmrErrors(response);

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
  const variablesResponse = await _cmrSearch('/search/variables.json', query, token);
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
  const collectionsResponse = await _cmrSearch('/search/collections.json', query, token);
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
  const granulesResponse = await _cmrSearch('/search/granules.json', query, token);
  const cmrHits = parseInt(granulesResponse.headers.get('cmr-hits'), 10);
  return {
    hits: cmrHits,
    granules: granulesResponse.data.feed.entry,
  };
}

/**
 * Performs a CMR granules.json search with the given form data
 *
 * @param {object} form The key/value pairs to search including a `shapefile` parameter
 * pointing to a file on the file system
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrGranule>>} The granule search results
 * @private
 */
async function queryGranuleUsingMultipartForm(form, token) {
  // TODO: Paging / hits
  const granuleResponse = await _cmrPostSearch('/search/granules.json', form, token);
  const cmrHits = parseInt(granuleResponse.headers.get('cmr-hits'), 10);
  return {
    hits: cmrHits,
    granules: granuleResponse.data.feed.entry,
  };
}

/**
 * Queries and returns the CMR JSON collections corresponding to the given CMR Collection IDs
 *
 * @param {Array<string>} ids The collection IDs to find
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrCollection>>} The collections with the given ids
 */
export function getCollectionsByIds(ids, token) {
  return queryCollections({
    concept_id: ids,
    page_size: 2000,
  }, token);
}

/**
 * Queries and returns the CMR JSON variables corresponding to the given CMR Variable IDs
 *
 * @param {Array<string>} ids The variable IDs to find
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrVariable>>} The variables with the given ids
 */
export function getVariablesByIds(ids, token) {
  return queryVariables({
    concept_id: ids,
    page_size: 2000,
  }, token);
}

/**
 * Queries and returns the CMR JSON variables that are associated with the given CMR JSON collection
 *
 * @param {CmrCollection} collection The collection whose variables should be returned
 * @param {string} token Access token for user request
 * @returns {Promise<Array<CmrVariable>>} The variables associated with the input collection
 */
export async function getVariablesForCollection(collection, token) {
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
export function queryGranulesForCollection(collectionId, query, token, limit = 10) {
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
export function queryGranulesForCollectionWithMultipartForm(collectionId, form, token, limit = 10) {
  const baseQuery = {
    collection_concept_id: collectionId,
    page_size: limit,
  };

  return queryGranuleUsingMultipartForm({
    ...baseQuery,
    ...form,
  }, token);
}

/**
 * Returns true if the user belongs to the given group.  Returns false if the user does not
 * belong to the group or the token cannot be used to query the group.
 *
 * @param username - The EDL username to test for membership
 * @param groupId - The group concept ID to check for membership
 * @param token - Access token for the request
 * @returns true if the group can be queried and the user is a member of the group
 */
export async function belongsToGroup(
  username: string,
  groupId: string,
  token: string,
): Promise<boolean> {
  const path = `/access-control/groups/${groupId}/members`;
  const response = await cmrSearchBase(path, null, token, { 'X-Harmony-User': username });
  return response.status === 200 && response.data.indexOf(username) !== -1;
}
