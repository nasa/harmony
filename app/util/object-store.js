const { URL } = require('url');
const querystring = require('querystring');
const aws = require('aws-sdk');

/**
 * Class to use when interacting with S3
 *
 * @class S3ObjectStore
 */
class S3ObjectStore {
  /**
   * Builds and returns an S3 object store configured according to environment variables
   * Will use localstack if USE_LOCALSTACK is true (default false) and AWS_DEFAULT_REGION
   * (default "us-west-2")
   *
   * @param {object} overrides values to set when constructing the underlying S3 store
   */
  constructor(overrides) {
    const endpointSettings = {};
    if (process.env.USE_LOCALSTACK === 'true') {
      endpointSettings.endpoint = 'http://localhost:4572';
      endpointSettings.s3ForcePathStyle = true;
    }

    this.s3 = new aws.S3({
      apiVersion: '2006-03-01',
      region: process.env.AWS_DEFAULT_REGION || 'us-west-2',
      signatureVersion: 'v4',
      ...endpointSettings,
      ...overrides,
    });
  }

  /**
   * Returns an HTTPS URL that can be used to perform a GET on the given object
   * store URL
   *
   * @param {string|URL} objectUrl the URL of the object to sign
   * @param {Object} params an optional mapping of parameter key/values to put in the URL
   * @returns {Promise<string>} a signed URL
   * @throws {TypeError} if the URL is not a recognized protocol or cannot be parsed
   * @memberof S3ObjectStore
   */
  async signGetObject(objectUrl, params) {
    const url = new URL(objectUrl);
    if (url.protocol.toLowerCase() !== 's3:') {
      throw new TypeError(`Invalid S3 URL: ${objectUrl}`);
    }
    const object = {
      Bucket: url.hostname,
      Key: url.pathname.substr(1), // Nuke leading "/"
    };
    // Verifies that the object exists, or throws NotFound
    await this.s3.headObject(object).promise();
    const req = this.s3.getObject(object);

    if (params) {
      req.on('build', () => { req.httpRequest.path += `?${querystring.stringify(params)}`; });
    }
    const result = await req.presign();
    return result;
  }
}

/**
 * Returns a class to interact with the object store appropriate for
 * the provided protocol, or null if no such store exists.
 *
 * @param {string} protocol the protocol used in object store URLs
 * @returns {ObjectStore} an object store for interacting with the given protocol
 */
function objectStoreForProtocol(protocol) {
  if (!protocol) {
    return null;
  }
  // Make sure the protocol is lowercase and does not end in a colon (as URL parsing produces)
  const normalizedProtocol = protocol.toLowerCase().replace(/:$/, '');
  if (normalizedProtocol === 's3') {
    return new S3ObjectStore();
  }
  return null;
}

module.exports = {
  objectStoreForProtocol,
  S3ObjectStore,
};
