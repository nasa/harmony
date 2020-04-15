const request = require('supertest');
const { before, after, it } = require('mocha');
const { expect } = require('chai');
const { auth } = require('./auth');

/**
 * Navigates to the STAC catalog route for the given job ID
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {String} jobId The job ID
 * @returns {Response} An awaitable object that resolves to the request response
 */
function stacCatalog(app, jobId) {
  return request(app).get(`/stac/${jobId}`);
}

/**
 * Adds before/after hooks to navigate to the STAC catalog route
 *
 * @param {String} jobId The job ID
 * @param {String} username optional user to simulate logging in as
 * @returns {void}
 */
function hookStacCatalog(jobId, username = undefined) {
  before(async function () {
    if (username) {
      this.res = await stacCatalog(this.frontend, jobId).use(auth({ username }));
    } else {
      this.res = await stacCatalog(this.frontend, jobId);
    }
  });
  after(function () {
    delete this.res;
  });
}

module.exports = {
  stacCatalog,
  hookStacCatalog,
};
