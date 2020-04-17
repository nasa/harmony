const request = require('supertest');
const { before, after } = require('mocha');
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
 * Navigates to the STAC item route for the given job ID and item index
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {String} jobId The job ID
 * @param {number} index The index of the stac item in the stac catalog
 * @returns {Response} An awaitable object that resolves to the request response
 */
function stacItem(app, jobId, index) {
  return request(app).get(`/stac/${jobId}/${index}`);
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

/**
* Adds before/after hooks to navigate to the STAC item route
*
* @param {String} jobId The job ID
* @param {number} index The item index
* @param {String} username optional user to simulate logging in as
* @returns {void}
*/
function hookStacItem(jobId, index, username = undefined) {
  before(async function () {
    if (username) {
      this.res = await stacItem(this.frontend, jobId, index).use(auth({ username }));
    } else {
      this.res = await stacItem(this.frontend, jobId, index);
    }
  });
  after(function () {
    delete this.res;
  });
}

module.exports = {
  stacCatalog,
  stacItem,
  hookStacCatalog,
  hookStacItem,
};
