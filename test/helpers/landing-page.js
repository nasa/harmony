const request = require('supertest');
const { hookRequest } = require('./hooks');

/**
 * Makes a cloud-access JSON request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
function landingPage(app) {
  return request(app).get('/');
}

const hookLandingPage = hookRequest.bind(this, landingPage);

module.exports = {
  landingPage,
  hookLandingPage,
};
