/* eslint-disable @typescript-eslint/dot-notation */
import { parse } from 'cookie';
import { Application } from 'express';
import { after, before } from 'mocha';
import request, { Test } from 'supertest';
import { auth } from './auth';

export const defaultCollection = 'C1233800302-EEDTEST';
export const defaultGranuleId = 'G1233800352-EEDTEST';
export const defaultCoverageId = 'all';
export const defaultVersion = '1.1.0';
type supportedEdrQueryType = 'cube' | 'area' | 'position';

interface QueryOptions {
  query?: object;
  headers?: object;
  cookies?: { shapefile: string };
  username?: string;
}

/**
 * Strip the signature from a signed cookie value
 *
 * @param value - The value portion of the cookie
 * @returns the unsigned cookie value
 */
export function stripSignature(value: string): string {
  let m = value.match(/^s:j:(.*)\..*$/);
  if (m) {
    return JSON.parse(m[1]);
  }
  m = value.match(/^s:(.*)\..*$/);
  if (m) {
    return m[1];
  }

  return value;
}

/**
 * Get value string from encoded cookie
 *
 * @param encodedValue - The encoded cookie value
 * @param key - The key for the cookie
 * @returns The unencoded cookie string
 */
function cookieValue(encodedValue: string, key: string): string {
  const decoded = decodeURIComponent(encodedValue);
  const parsed = parse(decoded);
  return stripSignature(parsed[key]);
}

/**
 * Adds before/after hooks to navigate from the EDR landing page to a related resource
 *
 * @param collection - The CMR Collection ID to query
 * @param version - The OGC API - EDR version to use
 */
export function hookLandingPage(collection: string, version: string): void {
  before(async function () {
    this.res = await request(this.frontend).get(`/ogc-api-edr/${version}/collections/${collection}/`);
  });

  after(function () {
    delete this.res;
  });
}

/**
 * Performs getDataForCube request on the given collection with the given params
 *
 * @param app - The express application (typically this.frontend)
 * @param version - The OGC EDR API version
 * @param collection - The CMR Collection ID to perform a service on
 * @param queryType - the type of call to make, e.g., 'cube'
 * @param options - additional options for the request
 * @returns The response
 */
export function edrRequest(
  queryType: supportedEdrQueryType,
  app: Application,
  version: string = defaultVersion,
  collection: string = defaultCollection,
  { query = {},
    headers = {},
    cookies = null }: QueryOptions = {},
): Test {
  let req = request(app)
    .get(`/ogc-api-edr/${version}/collections/${collection}/${queryType}`)
    .query(query)
    .set(headers);

  if (cookies) {
    req = req.set('Cookie', [cookies as unknown as string]);
  }
  return req;
}

/**
 * Performs getDataForCube request on the given collection with the given params
 *
 * @param app - The express application (typically this.frontend)
 * @param version - The OGC version
 * @param collection - The CMR Collection ID to perform a service on
 * @param queryType - the type of call to make, e.g., 'cube'
 * @param form - The JSON to pass to the request
 * @returns An 'awaitable' object that resolves to a Response
 */
export function postEdrRequest(
  queryType: supportedEdrQueryType,
  app: Express.Application,
  version: string,
  collection: string,
  form: object,
  queryString = '',
): Test {
  let urlPathAndParam = `/ogc-api-edr/${version}/collections/${collection}/${queryType}`;
  if (queryString) urlPathAndParam += `?${queryString}`;
  // POST parameter-name is of type array, not string
  form['parameter-name'] = form['parameter-name'].split(',');
  form['granuleId'] = form['granuleId'].split(',');
  form['scaleExtent'] = form['scaleExtent'].split(',').map(Number);
  form['scaleSize'] = form['scaleSize'].split(',').map(Number);
  const req = request(app)
    .post(urlPathAndParam)
    .send(form)
    .set('Content-Type', 'application/json');

  return req;
}

/**
 * Adds before/after hooks to run an OGC API getDataForCube request
 *
 * @param version - The OGC EDR API version
 * @param collection - The CMR Collection ID to perform a service on
 * @param queryType - the type of call to make, e.g., 'cube'
 * @param options - additional options for the request
 */
export function hookEdrRequest(
  queryType: supportedEdrQueryType, version?: string, collection?: string, {
    query = {},
    headers = {},
    username = undefined }: QueryOptions = {},
): void {
  before(async function () {
    if (!username) {
      this.res = await edrRequest(
        queryType,
        this.frontend,
        version,
        collection,
        { query, headers },
      );
    } else {
      this.res = await edrRequest(
        queryType,
        this.frontend,
        version,
        collection,
        { query, headers },
      ).use(auth({ username }));
    }
  });
  after(function () {
    delete this.res;
  });
}

/**
 * Adds before/after hooks to run a POST getDataForCube request
 *
 * @param version - The OGC API version
 * @param collection - The CMR Collection ID to perform a service on
 * @param form - The form data to be POST'd
 * @param queryType - the type of call to make, e.g., 'cube'
 * @param queryString - The query string parameters to pass to the request
 */
export function hookPostEdrRequest(
  queryType: supportedEdrQueryType, version: string, collection: string, form: object, queryString = '',
): void {
  before(async function () {
    this.res = await postEdrRequest(
      queryType,
      this.frontend,
      version,
      collection,
      form,
      queryString,
    );

    if (this.res.headers['set-cookie']) {
      const shapefileHeader = this.res.headers['set-cookie'].filter((cookie) => {
        const decoded = decodeURIComponent(cookie);
        const parsed = parse(decoded);
        return parsed.shapefile;
      })[0];

      const value = cookieValue(shapefileHeader, 'shapefile');
      const cookies = { shapefile: value };

      const redirectHeader = this.res.headers['set-cookie'].filter((cookie) => {
        const decoded = decodeURIComponent(cookie);
        const parsed = parse(decoded);
        return !parsed.shapefile;
      })[0];

      if (redirectHeader) {
        const redirect = cookieValue(redirectHeader, 'redirect');
        // HARMONY-290 Should be query params, not a string
        const query = redirect.split('?')[1];

        this.res = await edrRequest(
          queryType,
          this.frontend,
          version,
          collection,
          {
            query: query as unknown as object, // Fix along with HARMONY-290 to parse query params
            cookies,
          },
        ).use(auth({ username: 'fakeUsername', extraCookies: cookies }));
      }
    }
  });
  after(function () {
    delete this.res;
  });
}
