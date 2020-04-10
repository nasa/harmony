const request = require('supertest');
const { before, after } = require('mocha');

/**
 * Makes a cloud-access JSON request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
function landingPage(app) {
  return request(app).get('/');
}

/**
 * Adds before/after hooks to navigate to the cloud-access.sh route
 *
 * @returns {void}
 */
function hookLandingPage() {
  before(async function () {
    this.res = await landingPage(this.frontend);
  });
  after(function () {
    delete this.res;
  });
}

module.exports = {
  landingPage,
  hookLandingPage,
};
