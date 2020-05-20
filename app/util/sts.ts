import * as aws from 'aws-sdk';
import { AssumeRoleResponse } from 'aws-sdk/clients/sts';

import env = require('./env');
const { awsDefaultRegion } = env;

type AssumeRoleFn = (
  params: aws.STS.AssumeRoleRequest,
  callback?: (err: aws.AWSError, data: aws.STS.AssumeRoleResponse) => void
) => aws.Request<aws.STS.AssumeRoleResponse, aws.AWSError>;

/**
 * Class to use when interacting with AWS STS
 *
 * @class SecureTokenService
 */
export default class SecureTokenService {
  _assumeRole: AssumeRoleFn;

  /**
   * Builds and returns an AWS STS client configured according to environment variables
   * Will use localstack if USE_LOCALSTACK is true (default false) and AWS_DEFAULT_REGION
   * (default "us-west-2")
   *
   * @param {Object} overrides values to set when constructing the underlying S3 store
   */
  constructor(overrides?: aws.STS.ClientConfiguration) {
    this._assumeRole = this._getAssumeRole(overrides);
  }

  _getAssumeRole(overrides?: aws.STS.ClientConfiguration): AssumeRoleFn {
    const endpointSettings: aws.STS.ClientConfiguration = {};
    if (process.env.USE_LOCALSTACK === 'true') {
      endpointSettings.endpoint = 'http://localhost:4592';
    }

    return new aws.STS({
      apiVersion: '2011-06-15',
      region: awsDefaultRegion,
      ...endpointSettings,
      ...overrides,
    }).assumeRole;
  }

  /**
   * Calls AWS STS assumeRole returning credentials (see AWS S3 SDK `assumeRole`)
   *
   * @param {Object} params an object describing the role to assume
   * @returns {Promise<Object>} resolves to credentials with access to the role provided
   * @memberof SecureTokenService
   */
  async assumeRole(params: aws.STS.AssumeRoleRequest): Promise<AssumeRoleResponse> {
    return this._assumeRole(params).promise();
  }
}
