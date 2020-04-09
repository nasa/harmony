const request = require('supertest');
const { before, after } = require('mocha');
const { auth } = require('./auth');

/**
 * Makes a cloud-access JSON request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
function cloudAccessJson(app) {
  return request(app).get('/cloud-access');
}

/**
 * Adds before/after hooks to navigate to the cloud-access.sh route
 *
 * @param {String} username optional user to simulate logging in as
 * @returns {void}
 */
function hookCloudAccessJson(username = undefined) {
  before(async function () {
    if (username) {
      this.res = await cloudAccessJson(this.frontend).use(auth({ username }));
    } else {
      this.res = await cloudAccessJson(this.frontend);
    }
  });
  after(function () {
    delete this.res;
  });
}

/**
 * Makes a cloud-access.sh request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
function cloudAccessSh(app) {
  return request(app).get('/cloud-access');
}

/**
 * Adds before/after hooks to navigate to the cloud-access.sh route
 *
 * @param {String} username optional user to simulate logging in as
 * @returns {void}
 */
function hookCloudAccessSh(username = undefined) {
  before(async function () {
    if (username) {
      this.res = await cloudAccessSh(this.frontend).use(auth({ username }));
    } else {
      this.res = await cloudAccessSh(this.frontend);
    }
  });
  after(function () {
    delete this.res;
  });
}

module.exports = {
  cloudAccessJson,
  hookCloudAccessJson,
  cloudAccessSh,
  hookCloudAccessSh,
};
