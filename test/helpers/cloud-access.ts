import request from 'supertest';
import { readFileSync } from 'fs';
import { stub } from 'sinon';
import { AssumeRoleResponse } from 'aws-sdk/clients/sts';
import { hookRequest } from './hooks';
import sts from '../../app/util/sts';

/**
 * Makes a cloud-access JSON request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
export function cloudAccessJson(app: Express.Application): request.Test {
  return request(app).get('/cloud-access');
}

/**
 * Makes a cloud-access.sh request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
export function cloudAccessSh(app: Express.Application): request.Test {
  return request(app).get('/cloud-access.sh');
}

export const hookCloudAccessSh = hookRequest.bind(this, cloudAccessSh);
export const hookCloudAccessJson = hookRequest.bind(this, cloudAccessJson);

export const sampleCloudAccessJsonResponse = {
  Credentials: {
    AccessKeyId: 'XXXXXXXXXXXXXXXXXXXX',
    SecretAccessKey: 'XXXXXXXXXXXXXXXXXXXX1111111111+++++/////',
    SessionToken: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa++++++++++++++++++++++++++++++++++++++++++++++++++00000000000000000000000000000000000000000000000000//////////////////////////////////////////////////XXXXXX==================================================',
    Expiration: new Date('2020-04-10T18:03:46.337Z'),
  },
};

/**
 * Adds before/after hooks to stub the assumeRole call.
 *
 * @param response - The response to return when assumeRole is called
 */
export function hookStubAssumeRole(
  response: AssumeRoleResponse = sampleCloudAccessJsonResponse,
): void {
  let assumeRoleStub;
  before(async function () {
    assumeRoleStub = stub(sts.prototype, 'assumeRole')
      .callsFake(async () => response);
  });

  after(async function () {
    assumeRoleStub.restore();
  });
}

export const sampleCloudAccessShResponse = readFileSync('./test/resources/cloud-access-example-response.sh', 'utf-8');
