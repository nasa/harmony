import request from 'supertest';
import { before, after } from 'mocha';
import { stub as _stub } from 'sinon';
import { readFileSync } from 'fs';
import aws from 'aws-sdk';
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
  Credentials: {
    AccessKeyId: 'XXXXXXXXXXXXXXXXXXXX',
    SecretAccessKey: 'XXXXXXXXXXXXXXXXXXXX1111111111+++++/////',
    SessionToken: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa++++++++++++++++++++++++++++++++++++++++++++++++++00000000000000000000000000000000000000000000000000//////////////////////////////////////////////////XXXXXX==================================================',
    Expiration: '2020-04-10T18:03:46.337Z',
  },
};

/**
 * Adds before and after hooks to stub out calls to AWS STS.
 * @returns {void}
 */
export function hookAwsSts() {
  let stub;
  before(function () {
    stub = _stub(aws, 'STS')
      .returns({
        assumeRole: () => (
          { promise: async () => sampleCloudAccessJsonResponse }),
      });
  });
  after(function () {
    stub.restore();
  });
}

export const sampleCloudAccessShResponse = readFileSync('./test/resources/cloud-access-example-response.sh', 'utf-8');
