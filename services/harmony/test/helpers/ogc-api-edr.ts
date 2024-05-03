import { expect } from 'chai';
import { parse } from 'cookie';
import { Application } from 'express';
import { after, before, describe, it } from 'mocha';
import request, { Test } from 'supertest';
import * as url from 'url';
import { auth } from './auth';

export const defaultCollection = 'C1233800302-EEDTEST';
export const defaultGranuleId = 'G1233800352-EEDTEST';
export const defaultCoverageId = 'all';
export const defaultVersion = '1.0.0';

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
 * Adds before/after hooks to navigate from the coverages landing page to a related resource
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
 * Performs getDataForArea request on the given collection with the given params
 *
 * @param app - The express application (typically this.frontend)
 * @param version - The OGC coverages API version
 * @param collection - The CMR Collection ID to perform a service on
 * @param coverageId - The coverage ID(s) / variable name(s), or "all"
 * @param options - additional options for the request
 * @returns The response
 */
export function edrRequest(
  app: Application,
  version: string = defaultVersion,
  collection: string = defaultCollection,
  { query = {},
    headers = {},
    cookies = null }: QueryOptions = {},
): Test {
  // const encodedCoverageId = encodeURIComponent(coverageId);
  // query.variable = encodedCoverageId;
  let req = request(app)
    .get(`/ogc-api-edr/${version}/collections/${collection}/area`)
    .query(query)
    .set(headers);

  if (cookies) {
    req = req.set('Cookie', [cookies as unknown as string]);
  }
  return req;
}

/**
 * Performs getDataForArea request on the given collection with the given params
 * using a multipart/form-data POST
 *
 * @param app - The express application (typically this.frontend)
 * @param version - The OGC version
 * @param collection - The CMR Collection ID to perform a service on
 * @param coverageId - The coverage ID(s) / variable name(s), or "all"
 * @param form - The form parameters to pass to the request
 * @param queryString - The query string parameters to pass to the request
 * @returns An 'awaitable' object that resolves to a Response
 */
export function postEdrRequest(
  app: Express.Application, version: string, collection: string, form: object, queryString = '',
): Test {
  let urlPathAndParam = `/ogc-api-edr/${version}/collections/${collection}/area`;
  console.log(`==============form: ${JSON.stringify(form)}`);
  if (queryString) urlPathAndParam += `?${queryString}`;
  let req = request(app)
    .post(urlPathAndParam);

  Object.keys(form).forEach((key) => {
    if (key === 'shapefile') {
      req = req.attach(key, form[key].path, { contentType: form[key].mimetype, filename: 'foobar' });

      // req = req.attach(key, form[key].path, 'foobar');
    } else {
      req = req.field(key, form[key]);
    }
  });

  return req;
}

/**
 * Adds before/after hooks to run an OGC API getDataForArea request
 *
 * @param version - The OGC coverages API version
 * @param collection - The CMR Collection ID to perform a service on
 * @param coverageId - The coverage ID(s) / variable name(s), or "all"
 * @param options - additional options for the request
 */
export function hookEdrRequest(
  version?: string, collection?: string, {
    query = {},
    headers = {},
    username = undefined }: QueryOptions = {},
): void {
  before(async function () {
    if (!username) {
      this.res = await edrRequest(
        this.frontend,
        version,
        collection,
        { query, headers },
      );
    } else {
      this.res = await edrRequest(
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
 * Adds before/after hooks to run an OGC API getDataForArea request synchronously
 * by adding a default granule ID to the request.  Caller must ensure that the resulting
 * request is not constrained such that the granule is excluded
 *
 * @param version - The OGC coverages API version
 * @param collection - The CMR Collection ID to perform a service on
 * @param coverageId - The coverage ID(s) / variable name(s), or "all"
 * @param options - additional options for the request
 */
export function hookSyncEdrRequest(
  version?: string,
  collection?: string,
  {
    query = {},
    headers = {},
    username = 'anonymous',
  }: QueryOptions = {},
): void {
  hookEdrRequest(
    version,
    collection,
    { query: { granuleId: defaultGranuleId, ...query }, headers, username },
  );
}

/**
 * Adds before/after hooks to run a POST getDataForArea request
 *
 * @param version - The OGC API version
 * @param collection - The CMR Collection ID to perform a service on
 * @param coverageId - The coverage ID(s) / variable name(s), or "all"
 * @param form - The form data to be POST'd
 * @param queryString - The query string parameters to pass to the request
 */
export function hookPostEdrRequest(
  version: string, collection: string, form: object, queryString = '',
): void {
  before(async function () {
    this.res = await postEdrRequest(
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

/**
 * Adds before/after hooks to run an OGC API getDataForArea default request
 * where the caller just needs to run a request without caring about any of the
 * parameters to send to the request.
 *
 */
export function hookDefaultEdrRequest(): void {
  hookEdrRequest(defaultVersion,
    defaultCollection,
    {
      query: { variable: defaultCoverageId },
      username: 'anonymous',
    });
}

/**
 * Asserts that a link relation exists, then loads it, allowing the passed function to provide
 * further specs about its contents.  Expects the current page response to exist in the `this.res`
 * object.
 *
 * @param rel - The link relation to find in the "links" array of the current response
 * @param description - A human-readable name for what the relation is, e.g.
 *   "the Open API Spec"
 * @param fn - The body of the describe statement
 */
export function describeRelation(rel: string, description: string, fn: Function): void {
  it(`provides a link relation, \`${rel}\`, to ${description}`, function () {
    const parsedBody = JSON.parse(this.res.text);
    expect(parsedBody).to.have.key('links');
    const link = parsedBody.links.find((l) => l.rel === rel);
    expect(link, `${parsedBody.links} did not include relation ${rel}`).to.be.ok;
  });

  describe(`when following the \`${rel}\` relation to ${description}`, async function () {
    before(async function () {
      // Grab the link with the correct relation
      const parsedBody = JSON.parse(this.res.text);
      const link = parsedBody.links.find((l) => l.rel === rel);

      // Push the current response onto a stack so we can get back to it when we're done
      this.resStack = this.resStack || [];
      this.resStack.push(this.res);

      // Request the links href as a path relative to the app root (required by supertest)
      // and save that into the current `this.res` field
      const parsedLink = new url.URL(link.href);
      const relativeLink = [parsedLink.pathname, parsedLink.search].join('?');
      this.res = await request(this.frontend).get(relativeLink);
    });

    after(function () {
      // Restore `this.res`.  Not worried about cleaning up a possibly empty array.
      this.res = this.resStack.pop();
    });

    await fn.bind(this)();
  });
}

/**
 * Makes a call to return the OGC API EDR Open API spec.
 *
 * @param app - The express application (typically this.frontend)
 * @param collection - The CMR Collection ID to query
 * @param version - The specification version
 * @returns The response
 */
export function coveragesSpecRequest(
  app: Express.Application, collection: string, version: string,
): request.Test {
  return request(app).get(`/${collection}/ogc-api-coverages/${version}/api`);
}

/**
 * Makes a call to return the OGC API EDR landing page.
 *
 * @param app - The express application (typically this.frontend)
 * @param collection - The CMR Collection ID to query
 * @param version - The specification version
 * @returns The response
 */
export function coveragesLandingPageRequest(
  app: Express.Application, collection: string, version: string,
): request.Test {
  return request(app).get(`/${collection}/ogc-api-coverages/${version}/`);
}

/**
 * Makes a call to return the OGC API EDR describe collections page.
 *
 * @param app - The express application (typically this.frontend)
 * @param collection - The CMR Collection ID to query
 * @param version - The specification version
 * @param query - The query parameters to pass to the describe collections request
 * @returns The response
 */
export function describeCollectionsRequest(
  app: Express.Application, collection: string, version: string, query: object,
): request.Test {
  return request(app)
    .get(`/${collection}/ogc-api-coverages/${version}/collections`)
    .query(query);
}

/**
 * Adds before/after hooks when calling the OGC API EDR describe collections page.
 *
 * @param collection - The CMR Collection ID to query
 * @param version - The specification version
 * @param query - The query parameters to pass to the describe collections request
 */
export function hookDescribeCollectionsRequest(
  collection: string, version: string, query: object = {},
): void {
  before(async function () {
    this.res = await describeCollectionsRequest(this.frontend, collection, version, query);
  });

  after(function () {
    delete this.res;
  });
}

/**
 * Makes a call to return the OGC API EDR describe collections page.
 *
 * @param app - The express application (typically this.frontend)
 * @param collection - The CMR Collection ID to query
 * @param version - The specification version
 * @param variablePath - The full path of the variable
 * @param query - The query parameters to pass to the describe collections request
 * @returns The response
 */
export function describeCollectionRequest(
  app: Express.Application,
  collection: string,
  version: string,
  variablePath: string,
  query: object,
): request.Test {
  const encodedPath = encodeURIComponent(variablePath);
  return request(app)
    .get(`/${collection}/ogc-api-coverages/${version}/collections/${encodedPath}`)
    .query(query);
}

/**
 * Adds before/after hooks when calling the OGC API EDR describe collections page.
 *
 * @param collection - The CMR Collection ID to query
 * @param version - The specification version
 * @param variablePath - The full path of the variable
 * @param query - The query parameters to pass to the describe collections request
 */
export function hookDescribeCollectionRequest(
  collection: string, version: string, variablePath: string, query: object = {},
): void {
  before(async function () {
    this.res = await describeCollectionRequest(
      this.frontend,
      collection,
      version,
      variablePath,
      query,
    );
  });

  after(function () {
    delete this.res;
  });
}
