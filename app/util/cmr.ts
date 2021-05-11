import FormData from 'form-data';
import fs from 'fs';
import { get } from 'lodash';
import fetch, { Response } from 'node-fetch';
import * as querystring from 'querystring';
import * as util from 'util';
import { CmrError } from './errors';
import { objectStoreForProtocol } from './object-store';
import logger from './log';

import env = require('./env');

const unlink = util.promisify(fs.unlink);

const clientIdHeader = {
  'Client-id': `${env.harmonyClientId}`,
};

// Exported to allow tests to override cmrApiConfig
export const cmrApiConfig = {
  baseURL: env.cmrEndpoint,
  useToken: true,
};

const acceptJsonHeader = {
  Accept: 'application/json',
};

export interface CmrCollection {
  id: string;
  short_name: string;
  version_id: string;
  archive_center?: string;
  data_center?: string;
  boxes?: string[];
  points?: string[];
  lines?: string[];
  polygons?: string[][];
  time_start?: string;
  time_end?: string;
  associations?: {
    variables?: string[];
  };
  variables?: CmrUmmVariable[];
}

export interface CmrGranule {
  id: string;
  boxes?: string[];
  points?: string[];
  lines?: string[];
  polygons?: string[][];
  links?: CmrGranuleLink[];
  title: string;
  time_start: string;
  time_end: string;
}

export interface CmrGranuleLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
  hreflang?: string;
  inherited?: boolean;
}

export interface CmrGranuleHits {
  hits: number;
  granules: CmrGranule[];
}

export interface CmrUmmVariable {
  meta: {
    'concept-id': string;
  };
  umm: {
    Name: string;
    LongName?: string;
    Characteristics?: {
      GroupPath?: string;
    };
  };
}

export interface CmrVariable {
  concept_id: string;
  name: string;
  long_name: string;
}

export interface CmrQuery
  extends NodeJS.Dict<string | string[] | number | number[] | boolean | boolean[] | null> {
  concept_id?: string | string[];
  page_size?: number;
  downloadable?: boolean;
}

export interface CmrResponse extends Response {
  data?: unknown;
}

export interface CmrVariablesResponse extends CmrResponse {
  data: {
    items: CmrUmmVariable[];
  };
}

export interface CmrCollectionsResponse extends CmrResponse {
  data: {
    feed: {
      entry: CmrCollection[];
    };
  };
}

export interface CmrGranulesResponse extends CmrResponse {
  data: {
    feed: {
      entry: CmrGranule[];
    };
  };
}

/**
 * Create a token header for the given access token string
 *
 * @param token - The access token for the user
 * @returns An object with an 'Authorization' key and 'Bearer token' as the value,
 * or an empty object if the token is not set
 */
function _makeTokenHeader(token: string): object {
  return cmrApiConfig.useToken && token ? { Authorization: `Bearer ${token}` } : {};
}
/**
 * Handle any errors in the CMR response
 *
 * @param response - The response from the CMR
 * @throws CmrError - if the CMR response indicates an error
 */
function _handleCmrErrors(response: Response): void {
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
export async function cmrSearchBase(
  path: string, query: CmrQuery, token: string, extraHeaders = {},
): Promise<CmrResponse> {
  const querystr = querystring.stringify(query);
  const headers = {
    ...clientIdHeader,
    ..._makeTokenHeader(token),
    ...acceptJsonHeader,
    ...extraHeaders,
  };
  const response: CmrResponse = await fetch(`${cmrApiConfig.baseURL}${path}?${querystr}`,
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
 * @param path - The absolute path on the CMR API to the resource being queried
 * @param query - The key/value pairs to send to the CMR query string
 * @param token - Access token for user request
 * @returns The CMR query result
 * @throws CmrError - If the CMR returns an error status
 */
async function _cmrSearch(
  path: string, query: CmrQuery, token: string,
): Promise<CmrResponse> {
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
 * @param path - The URL path
 * @param formData - A FormData object or string body to be POST'd
 * @param headers - The headers to be sent with the POST
 * @returns A SuperAgent Response object
 */
export async function fetchPost(
  path: string, formData: FormData | string, headers: { [key: string]: string },
): Promise<CmrResponse> {
  const response: CmrResponse = await fetch(`${cmrApiConfig.baseURL}${path}`, {
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
 * @param geoJsonUrl - The location of the shapefile
 * @param formData - the Form data
 * @returns The a promise for a temporary filename containing the shapefile
 */
async function processGeoJson(geoJsonUrl: string, formData: FormData): Promise<string> {
  const tempFile = await objectStoreForProtocol(geoJsonUrl).downloadFile(geoJsonUrl);
  formData.append('shapefile', fs.createReadStream(tempFile), {
    contentType: 'application/geo+json',
  });
  return tempFile;
}

/**
 * Post a query to the CMR with the parameters in the given form
 *
 * @param path - The absolute path on the CMR API to the resource being queried
 * @param form - An object with keys and values representing the parameters for the query
 * @param token - Access token for the user
 * @returns The CMR query result
 */
export async function cmrPostSearchBase(
  path: string, form: object, token: string,
): Promise<CmrResponse> {
  const formData = new FormData();
  let shapefile = null;
  await Promise.all(Object.keys(form).map(async (key) => {
    const value = form[key];
    if (value !== null && value !== undefined) {
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
 * @param path - The absolute path on the cmR API to the resource being queried
 * @param form - An object with keys and values representing the parameters for the query
 * @param token - Access token for the user
 * @returns The CMR query result
 * @throws CmrError - If the CMR returns an error status
 */
async function _cmrPostSearch(path: string, form: CmrQuery, token: string): Promise<CmrResponse> {
  const response = await module.exports.cmrPostSearchBase(path, form, token);
  _handleCmrErrors(response);

  return response;
}

/**
 * Performs a CMR variables.json search with the given query string
 *
 * @param query - The key/value pairs to search
 * @param token - Access token for user request
 * @returns The variable search results
 */
async function queryVariables(
  query: CmrQuery, token: string,
): Promise<Array<CmrUmmVariable>> {
  const variablesResponse = await _cmrSearch('/search/variables.umm_json_v1_6', query, token) as CmrVariablesResponse;
  return variablesResponse.data.items;
}

/**
 * Performs a CMR collections.json search with the given query string
 *
 * @param query - The key/value pairs to search
 * @param token - Access token for user request
 * @returns The collection search results
 */
async function queryCollections(
  query: CmrQuery, token: string,
): Promise<Array<CmrCollection>> {
  const collectionsResponse = await _cmrSearch('/search/collections.json', query, token) as CmrCollectionsResponse;
  return collectionsResponse.data.feed.entry;
}

/**
 * Performs a CMR granules.json search with the given form data
 *
 * @param form - The key/value pairs to search including a `shapefile` parameter
 * pointing to a file on the file system
 * @param token - Access token for user request
 * @returns The granule search results
 */
async function queryGranuleUsingMultipartForm(
  form: CmrQuery,
  token: string,
): Promise<CmrGranuleHits> {
  // TODO: Paging / hits
  const granuleResponse = await _cmrPostSearch('/search/granules.json', form, token) as CmrGranulesResponse;
  const cmrHits = parseInt(granuleResponse.headers.get('cmr-hits'), 10);
  return {
    hits: cmrHits,
    granules: granuleResponse.data.feed.entry,
  };
}

/**
 * Queries and returns the CMR JSON collections corresponding to the given CMR Collection IDs
 *
 * @param ids - The collection IDs to find
 * @param token - Access token for user request
 * @returns The collections with the given ids
 */
export function getCollectionsByIds(
  ids: Array<string>, token: string,
): Promise<Array<CmrCollection>> {
  return queryCollections({
    concept_id: ids,
    page_size: 2000,
  }, token);
}

/**
 * Queries and returns the CMR JSON collections corresponding to the given collection short names
 *
 * @param shortName - The collection short name to search for
 * @param token - Access token for user request
 * @returns The collections with the given ids
 */
export function getCollectionsByShortName(
  shortName: string, token: string,
): Promise<Array<CmrCollection>> {
  return queryCollections({
    short_name: shortName,
    page_size: 2000,
    sort_key: '-revisionDate',
  }, token);
}

/**
 * Queries and returns the CMR JSON variables corresponding to the given CMR Variable IDs
 *
 * @param ids - The variable IDs to find
 * @param token - Access token for user request
 * @returns The variables with the given ids
 */
export function getVariablesByIds(
  ids: Array<string>,
  token: string,
): Promise<Array<CmrUmmVariable>> {
  return queryVariables({
    concept_id: ids,
    page_size: 2000,
  }, token);
}

/**
 * Queries and returns the CMR JSON variables that are associated with the given CMR JSON collection
 *
 * @param collection - The collection whose variables should be returned
 * @param token - Access token for user request
 * @returns The variables associated with the input collection
 */
export async function getVariablesForCollection(
  collection: CmrCollection, token: string,
): Promise<Array<CmrUmmVariable>> {
  const varIds = collection.associations && collection.associations.variables;
  if (varIds) {
    return getVariablesByIds(varIds, token);
  }
  return [];
}

/**
 * Queries and returns the CMR JSON granules for the given collection ID with the given query
 * params.  Uses multipart/form-data POST to accommodate large queries and shapefiles.
 *
 * @param collectionId - The ID of the collection whose granules should be searched
 * @param query - The CMR granule query parameters to pass
 * @param token - Access token for user request
 * @param limit - The maximum number of granules to return
 * @returns The granules associated with the input collection
 */
export function queryGranulesForCollection(
  collectionId: string, query: CmrQuery, token: string, limit = 10,
): Promise<CmrGranuleHits> {
  const baseQuery = {
    collection_concept_id: collectionId,
    page_size: limit,
  };

  return queryGranuleUsingMultipartForm({
    ...baseQuery,
    ...query,
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
  return response.status === 200 && (response.data as string[]).indexOf(username) !== -1;
}

/**
 * When given a regex, returns any granule links that match the given regex.
 * Return all non-inherited links with rel ending in /data# when no regex is provided.
 *
 * @param granule - The granule to obtain links from
 * @param urlPattern - The optional pattern to match/test the link href with
 * @returns An array of granule links
 */
export function filterGranuleLinks(
  granule: CmrGranule, urlPattern: string = null,
): CmrGranuleLink[] {
  let links: CmrGranuleLink[] = [];
  if (urlPattern) {
    // Match the pattern required by the backend service
    const urlRegex = new RegExp(urlPattern);
    links = granule.links.filter((g) => g.href.match(urlRegex) && !g.inherited);
  } else {
    links = granule.links.filter((g) => g.rel.endsWith('/data#') && !g.inherited);
  }
  return links;
}
