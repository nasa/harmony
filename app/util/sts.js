const aws = require('aws-sdk');

/**
 * Class to use when interacting with AWS STS
 *
 * @class SecureTokenService
 */
class SecureTokenService {
  /**
   * Builds and returns an AWS STS client configured according to environment variables
   * Will use localstack if USE_LOCALSTACK is true (default false) and AWS_DEFAULT_REGION
   * (default "us-west-2")
   *
   * @param {object} overrides values to set when constructing the underlying S3 store
   */
  constructor(overrides) {
    const endpointSettings = {};
    if (process.env.USE_LOCALSTACK === 'true') {
      endpointSettings.endpoint = 'http://localhost:4592';
    }

    this.sts = new aws.STS({
      apiVersion: '2011-06-15',
      region: process.env.AWS_DEFAULT_REGION || 'us-west-2',
      ...endpointSettings,
      ...overrides,
    });
  }

  /**
   * Calls AWS STS assumeRole returning credentials (see AWS S3 SDK `assumeRole`)
   *
   * @param {Object} params an object describing the role to assume
   * @returns {Object} credentials with access to the role provided
   * @memberof SecureTokenService
   */
  assumeRole(params) {
    const response = this.sts.assumeRole(params)
      .promise()
      .then(
        (data) => data,
        (error) => {
          throw new Error(error);
        },
      );
    return response;
  }
}

module.exports = { SecureTokenService };
