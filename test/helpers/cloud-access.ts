import request from 'supertest';
import { before, after } from 'mocha';
import { stub as sinonStub } from 'sinon';
import { readFileSync } from 'fs';
import SecureTokenService from 'harmony/util/sts';
import { hookRequest } from './hooks';

/**
 * Makes a cloud-access JSON request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
export function cloudAccessJson(app) {
  return request(app).get('/cloud-access');
}

/**
 * Makes a cloud-access.sh request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
export function cloudAccessSh(app) {
  return request(app).get('/cloud-access.sh');
}

export const hookCloudAccessSh = hookRequest.bind(this, cloudAccessSh);
export const hookCloudAccessJson = hookRequest.bind(this, cloudAccessJson);

export const sampleCloudAccessJsonResponse = {
  $response: {
    hasNextPage: (): boolean => false,
    nextPage: null,
    data: null,
    error: null,
    requestId: null,
    redirectCount: 0,
    retryCount: 0,
    httpResponse: null,
  },
  Credentials: {
    AccessKeyId: 'XXXXXXXXXXXXXXXXXXXX',
    SecretAccessKey: 'XXXXXXXXXXXXXXXXXXXX1111111111+++++/////',
    SessionToken: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa++++++++++++++++++++++++++++++++++++++++++++++++++00000000000000000000000000000000000000000000000000//////////////////////////////////////////////////XXXXXX==================================================',
    Expiration: new Date('2020-04-10T18:03:46.337Z'),
  },
};

/**
 * Adds before and after hooks to stub out calls to AWS STS.
 * @returns {void}
 */
export function hookAwsSts() {
  let stub;
  before(function () {
    stub = sinonStub(SecureTokenService.prototype, '_getAssumeRole')
      .returns(() => (
        {
          promise: async () => sampleCloudAccessJsonResponse,
          abort: () => null,
          createReadStream: () => null,
          eachPage: () => null,
          isPageable: () => false,
          send: () => null,
          on: () => null,
          onAsync: () => null,
          startTime: new Date(),
          httpRequest: null,
        }));
  });
  after(function () {
    stub.restore();
  });
}

export const sampleCloudAccessShResponse = readFileSync('./test/resources/cloud-access-example-response.sh', 'utf-8');
