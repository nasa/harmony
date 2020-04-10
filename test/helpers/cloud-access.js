const request = require('supertest');
const { before, after } = require('mocha');
const sinon = require('sinon');
const fs = require('fs');
const aws = require('aws-sdk');
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
  return request(app).get('/cloud-access.sh');
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

// These are not real AWS credentials
const sampleCloudAccessJsonResponse = {
  Credentials: {
    AccessKeyId: 'ASIA8NWMTLYQWIFCXH53',
    SecretAccessKey: 'Q5DzjpRCxXxgNCbLnsHbec+qDgqQcQZXDd+qEGEc',
    SessionToken: '***REMOVED***',
    Expiration: '2020-04-10T18:03:46.337Z',
  },
};

/**
 * Adds before and after hooks to stub out calls to AWS STS.
 * @returns {void}
 */
function hookAwsSts() {
  let stub;
  before(function () {
    stub = sinon.stub(aws, 'STS')
      .returns({
        assumeRole: () => ({ promise: () => ({ then: () => sampleCloudAccessJsonResponse }) }),
      });
  });
  after(function () {
    stub.restore();
  });
}

const sampleCloudAccessShResponse = fs.readFileSync('./test/resources/cloud-access-example-response.sh', 'utf-8');

module.exports = {
  cloudAccessJson,
  hookCloudAccessJson,
  cloudAccessSh,
  hookCloudAccessSh,
  sampleCloudAccessJsonResponse,
  sampleCloudAccessShResponse,
  hookAwsSts,
};
