const aws = require('aws-sdk');
const fs = require('fs');
const querystring = require('querystring');
const stream = require('stream');
const tmp = require('tmp');
const { URL } = require('url');
const util = require('util');

const pipeline = util.promisify(stream.pipeline);
const createTmpFileName = util.promisify(tmp.tmpName);
const readFile = util.promisify(fs.readFile);

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

  /**
   * Get an object from the object store (see AWS S3 SDK `getObject`)
   *
   * @param {Object|string} paramsOrUrl a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @param {*} callback an optional callback function
   * @returns  {AWS.Request} An object with a `promise` function that can be called to obtain a
   *   promise containing the retrieved object
   * @throws {TypeError} if an invalid URL is supplied
   * @memberof S3ObjectStore
   */
  getObject(paramsOrUrl, callback) {
    return this.s3.getObject(this._paramsOrUrlToParams(paramsOrUrl), callback);
  }

  /**
   * Helper method for converting a param that is either S3 parameters (Bucket, Key, etc) or
   * a URL into a param that is S3 parameters.
   *
   * @param {Object|string} paramsOrUrl a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @returns {Object} S3 parameters corresponding to the input
   * @throws {TypeError} if an invalid URL is supplied
   * @memberof S3ObjectStore
   */
  _paramsOrUrlToParams(paramsOrUrl) {
    let params = paramsOrUrl;
    if (typeof params === 'string') {
      const match = params.match(new RegExp('s3://([^/]+)/(.*)'));
      if (!match) {
        throw new TypeError(`getObject string does not seem to be an S3 URL: ${params}`);
      }
      params = { Bucket: match[1], Key: match[2] };
    }
    return params;
  }

  /**
   * Downloads the given object from the store, returning a temporary file location containing the
   * object.  Note, the caller MUST remove the file when complete
   *
   * @param {Object|string} paramsOrUrl a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @returns {string} path to a temporary file containing the object
   * @throws {TypeError} if an invalid URL is supplied
   * @memberof S3ObjectStore
   */
  async downloadFile(paramsOrUrl) {
    const tempFile = await createTmpFileName();
    const getObjectResponse = this.getObject(paramsOrUrl);
    await pipeline(getObjectResponse.createReadStream(), fs.createWriteStream(tempFile));
    return tempFile;
  }


  /**
   * Uploads the given file from the store, returning the URL to the uploaded file
   *
   * @param {string} fileName the path to the file to upload
   * @param {Object|string} paramsOrUrl a map of parameters (Bucket, Key) indicating the object to
   *   be uploaded or a URL location
   * @returns {Promise<string>} a URL to the uploaded file
   * @throws {TypeError} if an invalid URL is supplied
   * @memberof S3ObjectStore
   */
  async uploadFile(fileName, paramsOrUrl) {
    const fileContent = await readFile(fileName);
    const params = this._paramsOrUrlToParams(paramsOrUrl);
    params.Body = fileContent;
    await this.s3.upload(params).promise();
    return this.getUrlString(params.Bucket, params.Key);
  }

  /**
   * Stream upload an object to S3 (see AWS S3 SDK `upload`)
   *
   * @param {Object} params an object describing the upload
   * @param {Object} options an optional object containing settings to control the upload
   * @param {*} callback an optional callback function
   * @returns {AWS.S3.ManagedUpload} the managed upload object that can call send() or track
   * progress.
   * @memberof S3ObjectStore
   */
  upload(params, options, callback) {
    return this.s3.upload(params, options, callback);
  }

  /**
   * Returns a URL string for an object with the given bucket and key (prefix)
   *
   * @param {string} bucket the bucket containing the URL to construct
   * @param {string} key the key or key prefix for the location
   * @returns {string} the URL for the object
   * @memberof S3ObjectStore
   */
  getUrlString(bucket, key) {
    return `s3://${bucket}/${key}`;
  }
}

/**
 * Returns a class to interact with the object store appropriate for
 * the provided protocol, or null if no such store exists.
 *
 * @param {string} protocol the protocol used in object store URLs.  This may be a full URL, in
 *   which case the protocol will be read from the front of the URL.
 * @returns {ObjectStore} an object store for interacting with the given protocol
 */
function objectStoreForProtocol(protocol) {
  if (!protocol) {
    return null;
  }
  // Make sure the protocol is lowercase and does not end in a colon (as URL parsing produces)
  const normalizedProtocol = protocol.toLowerCase().split(':')[0];
  if (normalizedProtocol === 's3') {
    return new S3ObjectStore();
  }
  return null;
}

/**
 * Returns the default object store for this instance of Harmony.  Allows requesting an
 * object store without first knowing a protocol.
 *
 * @returns {ObjectStore} the default object store for Harmony.
 */
function defaultObjectStore() {
  return new S3ObjectStore();
}

module.exports = {
  objectStoreForProtocol,
  defaultObjectStore,
  S3ObjectStore,
};
