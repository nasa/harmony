const { parse } = require('cookie');
const url = require('url');
const request = require('supertest');
const { before, after, it, describe } = require('mocha');
const { expect } = require('chai');
const { auth } = require('./auth');

/**
 * Strip the signature from a signed cookie value
 *
 * @param {string} value The value portion of the cookie
 * @returns {string} the unsigned cookie value
 * @private
 */
function stripSignature(value) {
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
 * @param {string} encodedValue The encoded cookie value
 * @param {string} key The key for the cookie
 * @returns {string} The unencoded cookie string
 * @private
 */
function cookieValue(encodedValue, key) {
  const decoded = decodeURIComponent(encodedValue);
  const parsed = parse(decoded);
  return stripSignature(parsed[key]);
}

/**
 * Adds before/after hooks to navigate from the coverages landing page to a related resource
 *
 * @param {string} collection The CMR Collection ID to query
 * @param {string} version The OGC API - Coverages version to use
 * @returns {void}
 */
function hookLandingPage(collection, version) {
  before(async function () {
    this.res = await request(this.frontend).get(`/${collection}/ogc-api-coverages/${version}/`);
  });

  after(function () {
    delete this.res;
  });
}

/**
 * Performs getCoverageRangeset request on the given collection with the given params
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {String} version The OGC coverages API version
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} coverageId The coverage ID(s) / variable name(s), or "all"
 * @param {object} query The query parameters to pass to the EOSS request
 * @param {string} cookies The cookies to set on the call
 * @returns {Promise<Response>} The response
 */
function rangesetRequest(app, version, collection, coverageId, query, cookies = null) {
  const req = request(app)
    .get(`/${collection}/ogc-api-coverages/${version}/collections/${coverageId}/coverage/rangeset`);
  if (cookies) {
    req.set('Cookie', [cookies]);
  }
  return req.query(query);
}

/**
 * Performs getCoverageRangeset request on the given collection with the given params
 * using a multipart/form-data POST
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {String} version The OGC version
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} coverageId The coverage ID(s) / variable name(s), or "all"
 * @param {object} form The form parameters to pass to the request
 * @returns {Promise<Response>} The response
 */
async function postRangesetRequest(app, version, collection, coverageId, form) {
  const req = request(app)
    .post(`/${collection}/ogc-api-coverages/${version}/collections/${coverageId}/coverage/rangeset`);

  Object.keys(form).forEach((key) => {
    if (key === 'shapefile') {
      req.attach(key, form[key].path, { contentType: form[key].mimetype });
    } else {
      req.field(key, form[key]);
    }
  });

  return req;
}

/**
 * Adds before/after hooks to run an OGC API coverages rangeset request
 *
 * @param {String} version The OGC coverages API version
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} coverageId The coverage ID(s) / variable name(s), or "all"
 * @param {object} query The query parameters to pass to the rangeset request
 * @param {String} username Optional username to simulate logging in
 * @returns {void}
 */
function hookRangesetRequest(version, collection, coverageId, query, username = undefined) {
  before(async function () {
    if (!username) {
      this.res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        coverageId,
        query,
      );
    } else {
      this.res = await rangesetRequest(
        this.frontend,
        version,
        collection,
        coverageId,
        query,
      ).use(auth({ username }));
    }
  });
  after(function () {
    delete this.res;
  });
}

/**
 * Adds before/after hooks to run a POST getCoverageRangeset request
 *
 * @param {string} version The OGC API version
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} coverageId The coverage ID(s) / variable name(s), or "all"
 * @param {object} form The form data to be POST'd
 * @returns {void}
 */
function hookPostRangesetRequest(version, collection, coverageId, form) {
  before(async function () {
    this.res = await postRangesetRequest(
      this.frontend,
      version,
      collection,
      coverageId,
      form,
    );

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

    const redirect = cookieValue(redirectHeader, 'redirect');
    const query = redirect.split('?')[1];

    this.res = await rangesetRequest(
      this.frontend,
      version,
      collection,
      coverageId,
      query,
      cookies,
    ).use(auth({ username: 'fakeUsername', extraCookies: cookies }));
  });
  after(function () {
    delete this.res;
  });
}


/**
 * Asserts that a link relation exists, then loads it, allowing the passed function to provide
 * further specs about its contents.  Expects the current page response to exist in the `this.res`
 * object.
 *
 * @param {string} rel The link relation to find in the "links" array of the current response
 * @param {string} description A human-readable name for what the relation is, e.g.
 *   "the Open API Spec"
 * @param {function} fn The body of the describe statement
 * @returns {void}
 */
function describeRelation(rel, description, fn) {
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
 * Makes a call to return the OGC API Coverages Open API spec.
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {string} collection The CMR Collection ID to query
 * @param {String} version The specification version
 * @returns {Promise<Response>} The response
 */
function coveragesSpecRequest(app, collection, version) {
  return request(app).get(`/${collection}/ogc-api-coverages/${version}/api`);
}

/**
 * Makes a call to return the OGC API Coverages landing page.
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {string} collection The CMR Collection ID to query
 * @param {String} version The specification version
 * @returns {Promise<Response>} The response
 */
function coveragesLandingPageRequest(app, collection, version) {
  return request(app).get(`/${collection}/ogc-api-coverages/${version}/`);
}

/**
 * Makes a call to return the OGC API Coverages describe collections page.
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {string} collection The CMR Collection ID to query
 * @param {String} version The specification version
 * @param {Object} query The query parameters to pass to the describe collections request
 * @returns {Promise<Response>} The response
 */
function describeCollectionsRequest(app, collection, version, query) {
  return request(app)
    .get(`/${collection}/ogc-api-coverages/${version}/collections`)
    .query(query);
}

/**
 * Adds before/after hooks when calling the OGC API Coverages describe collections page.
 *
 * @param {string} collection The CMR Collection ID to query
 * @param {String} version The specification version
 * @param {Object} query The query parameters to pass to the describe collections request
 * @returns {void}
 */
function hookDescribeCollectionsRequest(collection, version, query = {}) {
  before(async function () {
    this.res = await describeCollectionsRequest(this.frontend, collection, version, query);
  });

  after(function () {
    delete this.res;
  });
}

/**
 * Makes a call to return the OGC API Coverages describe collections page.
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {String} collection The CMR Collection ID to query
 * @param {String} version The specification version
 * @param {String} variableName The name of the variable
 * @param {Object} query The query parameters to pass to the describe collections request
 * @returns {Promise<Response>} The response
 */
function describeCollectionRequest(app, collection, version, variableName, query) {
  return request(app)
    .get(`/${collection}/ogc-api-coverages/${version}/collections/${variableName}`)
    .query(query);
}

/**
 * Adds before/after hooks when calling the OGC API Coverages describe collections page.
 *
 * @param {String} collection The CMR Collection ID to query
 * @param {String} version The specification version
 * @param {String} variableName The name of the variable
 * @param {Object} query The query parameters to pass to the describe collections request
 * @returns {void}
 */
function hookDescribeCollectionRequest(collection, version, variableName, query = {}) {
  before(async function () {
    this.res = await describeCollectionRequest(
      this.frontend,
      collection,
      version,
      variableName,
      query,
    );
  });

  after(function () {
    delete this.res;
  });
}

module.exports = {
  hookLandingPage,
  hookRangesetRequest,
  rangesetRequest,
  postRangesetRequest,
  describeRelation,
  coveragesSpecRequest,
  coveragesLandingPageRequest,
  describeCollectionRequest,
  hookDescribeCollectionRequest,
  describeCollectionsRequest,
  hookDescribeCollectionsRequest,
  hookPostRangesetRequest,
  stripSignature,
};
