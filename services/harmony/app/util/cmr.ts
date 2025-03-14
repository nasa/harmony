/* eslint-disable @typescript-eslint/naming-convention */
import FormData from 'form-data';
import * as fs from 'fs';
import { v4 as uuid } from 'uuid';
import { get, isArray } from 'lodash';
import fetch, { Response } from 'node-fetch';
import * as querystring from 'querystring';
import { CmrError } from './errors';
import { defaultObjectStore, objectStoreForProtocol } from './object-store';
import env from './env';
import logger from './log';
import { UmmSpatial } from './spatial/umm-spatial';
import { isValidUri } from './url';
import RequestContext from '../models/request-context';

const { cmrEndpoint, cmrMaxPageSize, clientId, stagingBucket } = env;

const clientIdHeader = {
  'Client-id': `${clientId}`,
};

// Exported to allow tests to override cmrApiConfig
export const cmrApiConfig = {
  baseURL: cmrEndpoint,
  useToken: true,
};

const acceptJsonHeader = {
  Accept: 'application/json',
};

const jsonContentTypeHeader = {
  'Content-Type': 'application/json',
};

export enum CmrPermission {
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
  Order = 'order',
}

export interface CmrPermissionsMap {
  [key: string]: CmrPermission[];
}

export enum CmrTagKeys {
  HasEula = 'harmony.has-eula',
}

export interface CmrTags {
  [tagKey: string]: { data: object | boolean | string | number };
}

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
    services?: string[];
  };
  variables?: CmrUmmVariable[];
  tags?: CmrTags;
  eula_identifiers?: string[];
}

export interface CmrGranule {
  id: string;
  boxes?: string[];
  points?: string[];
  lines?: string[];
  polygons?: string[][];
  links?: CmrGranuleLink[];
  granule_size?: string;
  title: string;
  time_start: string;
  time_end: string;
  collection_concept_id?: string;
}

export interface CmrUmmGranule {
  meta: {
    'concept-id': string;
    'collection-concept-id': string;
  };
  umm: {
    TemporalExtent?: {
      RangeDateTime?: {
        BeginningDateTime: string;
        EndingDateTime?: string;
      };
      SingleDateTime?: string;
    };
    GranuleUR: string;
    SpatialExtent?: {
      HorizontalSpatialDomain?: {
        Geometry: UmmSpatial;
      };
    };
    DataGranule?: {
      ArchiveAndDistributionInformation?: {
        Size?: number;
      }[];
    };
    RelatedUrls?: {
      URL: string;
      Type: string;
      Description?: string;
      Subtype?: string;
      MimeType?: string;
    }[];
  };
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
  scrollID?: string;
  sessionKey?: string;
  searchAfter?: string;
}

export interface CmrUmmGranuleHits {
  hits: number;
  granules: CmrUmmGranule[];
  scrollID?: string;
  sessionKey?: string;
  searchAfter?: string;
}

export interface CmrUmmVariable {
  meta: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'concept-id': string;
  };
  umm: {
    Name: string;
    LongName?: string;
    RelatedURLs?: CmrRelatedUrl[];
    VariableType?: string;
    VariableSubType?: string;
  };
}

export interface UmmSubsetOptions {
  SpatialSubset?: {
    BoundingBox?: {
      AllowMultipleValues?: boolean;
    }
    Circle?: {
      AllowMultipleValues?: boolean;
    }
    Shapefile?: {
      Format?: string;
    }[];
  }
  VariableSubset?: {
    AllowMultipleValues?: boolean;
  }
  TemporalSubset?: {
    AllowMultipleValues?: boolean;
  }
}
export interface UmmServiceOptions {
  Subset?: UmmSubsetOptions;
  SupportedReformattings?: {
    SupportedInputFormat?: string;
    SupportedOutputFormats?: string[];
  }[];

  SupportedOutputProjections?: {
    ProjectionName?: string;
    ProjectionOutputAuthority?: string;
  }[];

  Aggregation?: {
    Concatenate?: {
      ConcatenateDefault?: boolean;
    }
  }
}

export interface CmrUmmService {
  meta: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'concept-id': string;
  };
  umm: {
    Name: string;
    ServiceOptions?: UmmServiceOptions;
  };
}

export interface CmrUmmGrid {
  meta: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'concept-id': string;
  };
  umm: {
    Name: string;
    GridDefinition: {
      CoordinateReferenceSystemID: {
        Code: string;
      };
      DimensionSize: {
        Height: number;
        Width: number;
      };
      DimensionScale: {
        X: {
          Minimum: number;
          Maximum: number;
          Resolution: number;
        };
        Y: {
          Minimum: number;
          Maximum: number;
          Resolution: number;
        };
      };
    };
  };
}

export interface CmrRelatedUrl {
  URL: string;
  URLContentType: string;
  Type: string;
  Subtype?: string;
  Description?: string;
  Format?: string;
  MimeType?: string;
}

export interface CmrQuery
  extends NodeJS.Dict<string | string[] | number | number[] | boolean | boolean[] | null> {
  bounding_box?: string;
  collection_concept_id?: string;
  concept_id?: string | string[];
  downloadable?: boolean;
  geojson?: string;
  page_size?: number;
  readable_granule_name?: string | string[];
  scroll?: string;
  temporal?: string;
}

export interface CmrAclQuery extends CmrQuery {
  user_id?: string;
  user_type?: string;
}

export interface CmrResponse extends Response {
  data?: unknown;
}

export interface CmrVariablesResponse extends CmrResponse {
  data: {
    items: CmrUmmVariable[];
    hits: number;
  };
}

export interface CmrServicesResponse extends CmrResponse {
  data: {
    items: CmrUmmService[];
    hits: number;
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

export interface CmrUmmGranulesResponse extends CmrResponse {
  data: {
    items: CmrUmmGranule[];
    hits: number;
  };
}

export interface CmrGridsResponse extends CmrResponse {
  data: {
    items: CmrUmmGrid[];
    hits: number;
  };
}

export interface CmrPermissionsResponse extends CmrResponse {
  data: CmrPermissionsMap;
}

export interface CmrUmmCollection {
  meta: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'concept-id': string;
  };
  umm: {
    ArchiveAndDistributionInformation?: {
      FileArchiveInformation: [{
        FormatType: string;
        Format: string;
      }]
    }
  };
}

export interface CmrUmmCollectionsResponse extends CmrResponse {
  data: {
    items: CmrUmmCollection[];
    hits: number;
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
 * Create a X-Request-Id header for the given request ID
 *
 * @param requestId - The request ID for the user's request
 * @returns An object with an 'X-Request-Id' key and and id as the value
 */
function makeXRequestIdHeader(requestId: string): object {
  return { 'X-Request-Id': requestId };
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
    logger.error(`CMR call failed with status '${status}'`);
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
 * Performs a CMR GET at the given path with the given query string
 *
 * @param context - Information related to the user's request
 * @param path - The absolute path on the CMR API to the resource being queried
 * @param query - The key/value pairs to send to the CMR query string
 * @param token - Access token for user request
 * @param extraHeaders - Additional headers to pass with the request
 * @returns The CMR query result
 */
export async function cmrGetBase(
  context: RequestContext, path: string, query: CmrQuery, token: string, extraHeaders = {},
): Promise<CmrResponse> {
  const querystr = querystring.stringify(query);
  const headers = {
    ...clientIdHeader,
    ..._makeTokenHeader(token),
    ...makeXRequestIdHeader(context.id),
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
 * Performs a CMR GET at the given path with the given query string. This function wraps
 * `cmrGetBase` to make it easier to test.
 *
 * @param context - Information related to the user's request
 * @param path - The absolute path on the CMR API to the resource being queried
 * @param query - The key/value pairs to send to the CMR query string
 * @param token - Access token for user request
 * @returns The CMR query result
 * @throws CmrError - If the CMR returns an error status
 */
async function _cmrGet(
  context: RequestContext, path: string, query: CmrQuery, token: string,
): Promise<CmrResponse> {
  const response = await cmrGetBase(context, path, query, token);
  _handleCmrErrors(response);
  return response;
}

/**
 * Use `fetch` to POST multipart/form-data. This code has been pulled into a separate
 * function simply as a work-around to a bug in `node replay` that breaks shapefile
 * uploads to the CMR. By pulling it into a separate function we can stub it to have
 * the necessary response.
 *
 * @param context - Information related to the user's request
 * @param path - The URL path
 * @param formData - A FormData object or string body to be POST'd
 * @param headers - The headers to be sent with the POST
 * @returns A SuperAgent Response object
 */
export async function fetchPost(
  context: RequestContext, path: string, formData: FormData | string, headers: { [key: string]: string },
): Promise<CmrResponse> {
  const fullHeaders = {
    ...headers,
    ...makeXRequestIdHeader(context.id),
  };
  const response: CmrResponse = await fetch(`${cmrApiConfig.baseURL}${path}`, {
    method: 'POST',
    body: formData,
    headers: fullHeaders,
  });
  response.data = await response.json();

  return response;
}

/**
 * Helper function to check if a string is valid JSON
 * @param str - the string to check
 * @returns true if the string can be parsed as JSON and false otherwise
 */
function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Process a GeoJSON entry by downloading the file from S3 and adding an entry for it in
 * a multipart/form-data object to be uploaded to the CMR. If the geojson is a string rather
 * than a reference to a file, just directly set the content in the passed in form-data
 *
 * @param geoJsonOrUri - Either a geojson string or the URI to the shapefile
 * @param formData - the form data to which to add the shapefile
 * @returns a promise for a temporary filename containing the shapefile or null if no file is used
 */
async function processGeoJson(geoJsonOrUri: string, formData: FormData): Promise<string> {
  if (isValidUri(geoJsonOrUri) || !isValidJSON(geoJsonOrUri)) {
    const tempFile = await objectStoreForProtocol(geoJsonOrUri).downloadFile(geoJsonOrUri);
    formData.append('shapefile', fs.createReadStream(tempFile), {
      contentType: 'application/geo+json',
    });
    return tempFile;
  } else {
    logger.info('GEOJSON :');
    logger.info(geoJsonOrUri);
    const buf = Buffer.from(geoJsonOrUri);
    formData.append('shapefile', buf, {
      contentType: 'application/geo+json',
      // Must include a filename or CMR gets unhappy
      filename: 'fake.geojson',
    });
  }

  return null;
}

/**
 *  Check a field on a CmrQuery to see if it has wildcard values. If so, add an
 * `options[fieldName][patter] = true` to the given `FormData` object.
 *
 * @param formData - the form data to be altered if the given field has wildcards
 * @param form - the form data to be checked
 * @param field -the field to check for wildcards
 */
function handleWildcards(formData: FormData, form: CmrQuery, field: string): void {
  const re = /(\*|\?)/;
  const values = form[field];
  if (!values) {
    return;
  }
  let isPattern = false;
  if (isArray(values)) {
    for (const value of values as Array<unknown>) {
      if (re.test(value.toString())) {
        isPattern = true;
        break;
      }
    }
  } else {
    if (re.test(values.toString())) {
      isPattern = true;
    }
  }

  if (isPattern) {
    formData.append(`options[${field}][pattern]`, 'true');
  }
}

/**
 * Post a query to the CMR with the parameters in the given form
 *
 * @param context - Information related to the user's request
 * @param path - The absolute path on the CMR API to the resource being queried
 * @param form - An object with keys and values representing the parameters for the query
 * @param token - Access token for the user
 * @param extraHeaders - Additional headers to pass with the request
 * @returns The CMR query result
 */
export async function cmrPostBase(
  context: RequestContext,
  path: string,
  form: object,
  token: string,
  extraHeaders = {},
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

  handleWildcards(formData, form as CmrQuery, 'readable_granule_name');

  const headers = {
    ...clientIdHeader,
    ..._makeTokenHeader(token),
    ...acceptJsonHeader,
    ...formData.getHeaders(),
    ...extraHeaders,
  };

  try {
    const response = await module.exports.fetchPost(context, path, formData, headers);
    return response;
  } finally {
    if (shapefile) {
      try {
        await fs.promises.unlink(shapefile);
      } catch (e) {
        logger.error(`Failed to delete file ${shapefile}`);
        logger.error(e);
      }
    }
  }
}

/**
 * Post a query to the CMR with the parameters in the given form. This function wraps
 * `CmrPostBase` to make it easier to test.
 *
 * @param context - Information related to the user's request
 * @param path - The absolute path on the cmR API to the resource being queried
 * @param form - An object with keys and values representing the parameters for the query
 * @param token - Access token for the user
 * @param extraHeaders - Additional headers to pass with the request
 * @returns The CMR query result
 * @throws CmrError - If the CMR returns an error status
 */
async function _cmrPost(
  context: RequestContext,
  path: string,
  form: CmrQuery,
  token: string,
  extraHeaders = {},
): Promise<CmrResponse> {
  const headers = {
    ...extraHeaders,
    'X-Request-Id': context.id,
  };
  const response = await module.exports.cmrPostBase(context, path, form, token, headers);
  _handleCmrErrors(response);

  return response;
}

/**
 * POST data to the CMR using data for the body instead of a multipart form
 *
 * @param path - The absolute path on the cmR API to the resource being queried
 * @param body - Data to POST
 * @param extraHeaders - Additional headers to pass with the request
 * @returns The CMR result
 */
async function _cmrPostBody(
  path: string,
  body: object,
  extraHeaders = {},
): Promise<CmrResponse> {
  const headers = {
    ...clientIdHeader,
    ...acceptJsonHeader,
    ...jsonContentTypeHeader,
    ...extraHeaders,
  };
  const response = await fetch(`${cmrApiConfig.baseURL}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
  _handleCmrErrors(response);

  return response;
}

/**
 * Performs a CMR variables.json search with the given query string. If there are more
 * than 2000 variables, page through the variable results until all are retrieved.
 *
 * @param context - Information related to the user's request
 * @param query - The key/value pairs to search
 * @param token - Access token for user request
 * @returns The variable search results
 */
export async function getAllVariables(
  context: RequestContext, query: CmrQuery, token: string,
): Promise<Array<CmrUmmVariable>> {
  const variablesResponse = await _cmrPost(context, '/search/variables.umm_json_v1_8_1', query, token) as CmrVariablesResponse;
  const { hits } = variablesResponse.data;
  let variables = variablesResponse.data.items;
  let numVariablesRetrieved = variables.length;
  let page_num = 1;

  while (numVariablesRetrieved < hits) {
    page_num += 1;
    logger.debug(`Paging through variables = ${page_num}, numVariablesRetrieved = ${numVariablesRetrieved}, total hits ${hits}`);
    query.page_num = page_num;
    const response = await _cmrPost(context, '/search/variables.umm_json_v1_8_1', query, token) as CmrVariablesResponse;
    const pageOfVariables = response.data.items;
    variables = variables.concat(pageOfVariables);
    numVariablesRetrieved += pageOfVariables.length;
    if (pageOfVariables.length == 0) {
      logger.warn(`Expected ${hits} variables, but only retrieved ${numVariablesRetrieved} from CMR.`);
      break;
    }
  }

  return variables;
}

/**
 * Performs a CMR services.umm_json search with the given query string. If there are more
 * than 2000 services, page through the service results until all are retrieved.
 *
 * @param context - Information related to the user's request
 * @param query - The key/value pairs to search
 * @param token - Access token for user request
 * @returns The services search results
 */
export async function getAllServices(
  context: RequestContext, query: CmrQuery, token: string,
): Promise<Array<CmrUmmService>> {
  const servicesResponse = await _cmrPost(context, '/search/services.umm_json_v1_5_2', query, token) as CmrServicesResponse;
  const { hits } = servicesResponse.data;
  let services = servicesResponse.data.items;
  let numServicesRetrieved = services.length;
  let page_num = 1;

  while (numServicesRetrieved < hits) {
    page_num += 1;
    logger.debug(`Paging through services = ${page_num}, numServicesRetrieved = ${numServicesRetrieved}, total hits ${hits}`);
    query.page_num = page_num;
    const response = await _cmrPost(context, '/search/services.umm_json_v1_5_2', query, token) as CmrServicesResponse;
    const pageOfServices = response.data.items;
    services = services.concat(pageOfServices);
    numServicesRetrieved += pageOfServices.length;
    if (pageOfServices.length == 0) {
      logger.warn(`Expected ${hits} services, but only retrieved ${numServicesRetrieved} from CMR.`);
      break;
    }
  }

  return services;
}

/**
 * Performs a CMR collections.json search with the given query string
 *
 * @param context - Information related to the user's request
 * @param query - The key/value pairs to search
 * @param token - Access token for user request
 * @returns The collection search results
 */
async function queryCollections(
  context: RequestContext, query: CmrQuery, token: string,
): Promise<Array<CmrCollection>> {
  const collectionsResponse = await _cmrGet(context, '/search/collections.json', query, token) as CmrCollectionsResponse;
  return collectionsResponse.data.feed.entry;
}

/**
 * Performs a CMR collections.umm_json search with the given query string
 *
 * @param context - Information related to the user's request
 * @param query - The key/value pairs to search
 * @param token - Access token for user request
 * @returns The umm collection search results
 */
async function queryUmmCollections(
  context: RequestContext, query: CmrQuery, token: string,
): Promise<Array<CmrUmmCollection>> {
  const ummResponse = await _cmrGet(context, '/search/collections.umm_json_v1_17_3', query, token) as CmrUmmCollectionsResponse;
  return ummResponse.data.items;
}

/**
 * Performs a CMR grids.umm_json search with the given query string
 *
 * @param context - Information related to the user's request
 * @param query - The key/value pairs to search
 * @param token - Access token for user request
 * @returns The grid search results
 */
async function queryGrids(
  context: RequestContext, query: CmrQuery, token: string,
): Promise<Array<CmrUmmGrid>> {
  const gridsResponse = await _cmrGet(context, '/search/grids.umm_json', query, token) as CmrGridsResponse;
  return gridsResponse.data.items;
}

/**
 * Performs a CMR granules.json search with the given form data
 *
 * @param context - Information related to the user's request
 * @param form - The key/value pairs to search including a `shapefile` parameter
 * pointing to a file on the file system
 * @param token - Access token for user request
 * @param extraHeaders - Additional headers to pass with the request
 * @returns The granule search results
 */
export async function queryGranuleUsingMultipartForm(
  context: RequestContext,
  form: CmrQuery,
  token: string,
  extraHeaders = {},
  resultFormat = 'json',
): Promise<CmrGranuleHits | CmrUmmGranuleHits> {
  let granuleResponse = null;
  if (resultFormat === 'json') {
    granuleResponse = await _cmrPost(context, `/search/granules.${resultFormat}`, form, token, extraHeaders) as CmrGranulesResponse;
  } else {
    granuleResponse = await _cmrPost(context, `/search/granules.${resultFormat}`, form, token, extraHeaders) as CmrUmmGranulesResponse;
  }
  const cmrHits = parseInt(granuleResponse.headers.get('cmr-hits'), 10);
  const searchAfter = granuleResponse.headers.get('cmr-search-after');
  return {
    hits: cmrHits,
    granules: (resultFormat === 'json') ? granuleResponse.data.feed.entry : granuleResponse.data.items,
    searchAfter,
  };
}

/**
 * Queries and returns the CMR JSON collections corresponding to the given CMR Collection IDs
 *
 * @param context - Information related to the user's request
 * @param ids - The collection IDs to find
 * @param token - Access token for user request
 * @param includeTags - Include tags with tag_key matching this value
 * @returns The collections with the given ids
 */
export async function getCollectionsByIds(
  context: RequestContext,
  ids: Array<string>,
  token: string,
  includeTags?: string,
): Promise<Array<CmrCollection>> {
  const query = {
    ...(includeTags && { include_tags: includeTags }),
    ...{
      concept_id: ids,
      page_size: cmrMaxPageSize,
    },
  };
  return queryCollections(context, query, token);
}

/**
 * Queries and returns the CMR UMM JSON collections corresponding to the given CMR Collection IDs
 *
 * @param context - Information related to the user's request
 * @param ids - The collection IDs to find
 * @param token - Access token for user request
 * @param includeTags - Include tags with tag_key matching this value
 * @returns The umm collections with the given ids
 */
export async function getUmmCollectionsByIds(
  context: RequestContext,
  ids: Array<string>,
  token: string,
): Promise<Array<CmrUmmCollection>> {
  const query = {
    concept_id: ids,
    page_size: cmrMaxPageSize,
  };
  return queryUmmCollections(context, query, token);
}

/**
 * Queries and returns the CMR JSON collections corresponding to the given collection short names
 *
 * @param context - Information related to the user's request
 * @param shortName - The collection short name to search for
 * @param token - Access token for user request
 * @returns The collections with the given ids
 */
export async function getCollectionsByShortName(
  context: RequestContext, shortName: string, token: string,
): Promise<Array<CmrCollection>> {
  return queryCollections(
    context,
    {
      short_name: shortName,
      page_size: cmrMaxPageSize,
      sort_key: '-revisionDate',
    }, token);
}

// We have an environment variable called CMR_MAX_PAGE_SIZE which is used for how many items
// to scroll through for each page of granule results. The value may not match the actual
// CMR maximum page size which has been 2000 since inception. For pulling back variables we
// want to get as many as we can per page for better performance, so we use the actual limit.
const ACTUAL_CMR_MAX_PAGE_SIZE = 2000;

/**
 * Queries and returns the CMR JSON variables corresponding to the given CMR Variable IDs
 *
 * @param context - Information related to the user's request
 * @param ids - The variable IDs to find
 * @param token - Access token for user request
 * @returns The variables with the given ids
 */
export async function getVariablesByIds(
  context: RequestContext,
  ids: Array<string>,
  token: string,
): Promise<Array<CmrUmmVariable>> {
  return getAllVariables(
    context,
    {
      concept_id: ids,
      page_size: ACTUAL_CMR_MAX_PAGE_SIZE,
    }, token);
}

/**
 * Queries and returns the CMR JSON variables that are associated with the given CMR JSON collection
 *
 * @param context - Information related to the user's request
 * @param collection - The collection whose variables should be returned
 * @param token - Access token for user request
 * @returns The variables associated with the input collection
 */
export async function getVariablesForCollection(
  context: RequestContext, collection: CmrCollection, token: string,
): Promise<Array<CmrUmmVariable>> {
  const varIds = collection.associations && collection.associations.variables;
  if (varIds) {
    return getVariablesByIds(context, varIds, token);
  }
  return [];
}

/**
 * Queries and returns the CMR JSON services corresponding to the given CMR UMM Service IDs
 *
 * @param context - Information related to the user's request
 * @param ids - The CMR concept IDs for the services to find
 * @param token - Access token for user request
 * @returns The services with the given ids
 */
export async function getServicesByIds(
  context: RequestContext,
  ids: Array<string>,
  token: string,
): Promise<Array<CmrUmmService>> {
  return getAllServices(
    context,
    {
      concept_id: ids,
      page_size: ACTUAL_CMR_MAX_PAGE_SIZE,
    }, token);
}

/**
 * Queries the CMR grids for grid(s) with the given name. Ideally only one grid should match.
 *
 * @param context - Information related to the user's request
 * @param gridName - The name of the grid for which to search
 * @param token - Access token for user request
 * @returns an array of UMM Grids matching the passed in name (ideally only one item)
 */
export async function getGridsByName(
  context: RequestContext, gridName: string, token: string,
): Promise<Array<CmrUmmGrid>> {
  return queryGrids(context, { name: gridName, page_size: ACTUAL_CMR_MAX_PAGE_SIZE }, token);
}

/**
 * Generate an s3 url to use to store/lookup stored query parameters
 *
 * @param sessionKey - The session key
 * @returns An s3 url containing the session key
 */
function s3UrlForStoredQueryParams(sessionKey: string): string {
  return `s3://${stagingBucket}/SearchParams/${sessionKey}/serializedQuery`;
}

/**
 * Queries and returns the CMR JSON granules for the given search after values and session key.
 *
 * @param context - Information related to the user's request
 * @param token - Access token for user request
 * @param limit - The maximum number of granules to return in this page of results
 * @param query - The CMR granule query parameters to pass
 * @param sessionKey - Key used to look up query parameters
 * @param searchAfterHeader - Value string to use for the cmr-search-after header
 * @param resultFormat - Desired output format for the query - defaults to `json`
 * @returns A CmrGranuleHits object containing the granules associated with the input collection
 * and a session key and cmr-search-after header
 */
export async function queryGranulesWithSearchAfter(
  context: RequestContext,
  token: string,
  limit: number,
  query?: CmrQuery,
  sessionKey?: string,
  searchAfterHeader?: string,
  resultFormat = 'json',
): Promise<CmrGranuleHits | CmrUmmGranuleHits> {
  const baseQuery = {
    page_size: cmrMaxPageSize ? Math.min(limit, cmrMaxPageSize) : limit,
  };
  let response: CmrGranuleHits | CmrUmmGranuleHits;
  let headers = {};
  if (searchAfterHeader) {
    headers = { 'cmr-search-after': searchAfterHeader };
  }
  if (sessionKey) {
    // use the session key to get the stored query parameters from the s3 bucket
    const url = s3UrlForStoredQueryParams(sessionKey);
    const storedQuery = await defaultObjectStore().getObjectJson(url);
    const fullQuery = { ...baseQuery, ...storedQuery };
    response = await queryGranuleUsingMultipartForm(
      context,
      fullQuery,
      token,
      headers,
      resultFormat,
    );
    response.sessionKey = sessionKey;
  } else {
    // generate a session key and store the query parameters in the staging bucket using the key
    const newSessionKey = uuid();
    const url = s3UrlForStoredQueryParams(newSessionKey);
    await defaultObjectStore().upload(JSON.stringify(query), url);
    const fullQuery = { ...baseQuery, ...query };
    response = await queryGranuleUsingMultipartForm(
      context,
      fullQuery,
      token,
      {},
      resultFormat,
    );
    // NOTE response.hits in this case will be the cmr-hits total, not the number of granules
    // returned in this request
    response.sessionKey = newSessionKey;
  }

  return response;
}

/**
 * Queries and returns the CMR JSON granules for the given collection ID with the given query
 * params.  Uses multipart/form-data POST to accommodate large queries and shapefiles.
 *
 * @param context - Information related to the user's request
 * @param collectionId - The ID of the collection whose granules should be searched
 * @param query - The CMR granule query parameters to pass
 * @param token - Access token for user request
 * @param limit - The maximum number of granules to return
 * @returns The granules associated with the input collection
 */
export function queryGranulesForCollection(
  context: RequestContext, collectionId: string, query: CmrQuery, token: string, limit = 10,
): Promise<CmrGranuleHits> {
  const baseQuery = {
    collection_concept_id: collectionId,
    page_size: Math.min(limit, cmrMaxPageSize),
  };

  const result: unknown = queryGranuleUsingMultipartForm(
    context,
    {
      ...baseQuery,
      ...query,
    }, token);

  return result as Promise<CmrGranuleHits>;
}


/**
 * Queries and returns the CMR permissions for each concept specified
 *
 * @param context - Information related to the user's request
 * @param ids - Check the user permissions for these concept IDs
 * @param token - Access token for user request
 * @param username - Check the collection permissions for this user,
 * or the guest user if this is blank
 * @returns The CmrPermissionsMap which maps concept id to a permissions array
 */
export async function getPermissions(
  context: RequestContext,
  ids: Array<string>,
  token: string,
  username?: string,
): Promise<CmrPermissionsMap> {
  if (!ids.length) {
    return {};
  }
  const baseQuery: CmrQuery = { concept_id: ids };
  const query: CmrAclQuery = username
    ? { user_id: username, ...baseQuery }
    : { user_type: 'guest', ...baseQuery };
  const permissionsResponse = await _cmrGet(context, '/access-control/permissions', query, token) as CmrPermissionsResponse;
  return permissionsResponse.data;
}

/**
 * Return all non-inherited links with rel ending in /data# or /service#.
 *
 * @param granule - The granule to obtain links from
 * @returns An array of granule links
 */
export function filterGranuleLinks(
  granule: CmrGranule,
): CmrGranuleLink[] {
  return granule.links.filter((g) => (g.rel.endsWith('/data#') || g.rel.endsWith('/service#'))
    && !g.inherited);
}
