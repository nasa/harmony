const url = require('url');
const request = require('supertest');
const { before, after, it, describe } = require('mocha');
const { expect } = require('chai');
const { auth } = require('./auth');

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
 * @param {String} version The EOSS version
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} coverageId The coverage ID(s) / variable name(s), or "all"
 * @param {object} query The query parameters to pass to the EOSS request
 * @returns {Promise<Response>} The response
 */
function rangesetRequest(app, version, collection, coverageId, query) {
  return request(app)
    .get(`/${collection}/ogc-api-coverages/${version}/collections/${coverageId}/coverage/rangeset`)
    .query(query);
}

/**
 * Adds before/after hooks to run an EOS service request
 *
 * @param {String} version The EOSS version
 * @param {string} collection The CMR Collection ID to perform a service on
 * @param {string} coverageId The coverage ID(s) / variable name(s), or "all"
 * @param {object} query The query parameters to pass to the EOSS request
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

module.exports = {
  hookLandingPage,
  hookRangesetRequest,
  rangesetRequest,
  describeRelation,
  coveragesSpecRequest,
  coveragesLandingPageRequest,
};
