import aws from 'aws-sdk';
import * as fs from 'fs';
import * as querystring from 'querystring';
import * as stream from 'stream';
import tmp from 'tmp';
import { URL } from 'url';
import * as util from 'util';
import { PromiseResult } from 'aws-sdk/lib/request';

import env = require('./env');

const { awsDefaultRegion } = env;

const pipeline = util.promisify(stream.pipeline);
const createTmpFileName = util.promisify(tmp.tmpName);
const readFile = util.promisify(fs.readFile);

interface BucketParams {
  Bucket: string;
  Key: string;
}

/**
 * Read a stream into a string
 * 
 * @param readableStream - The stream to read
 * @returns A string containing the contents of the stream
 */
async function streamToString(readableStream: stream.Readable): Promise<string> {
  const chunks = [];

  for await (const chunk of readableStream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Class to use when interacting with S3
 *
 */
export class S3ObjectStore {
  s3: aws.S3;

  /**
   * Builds and returns an S3 object store configured according to environment variables
   * Will use localstack if USE_LOCALSTACK is true (default false) and AWS_DEFAULT_REGION
   * (default "us-west-2")
   *
   * @param overrides - values to set when constructing the underlying S3 store
   */
  constructor(overrides?: object) {
    this.s3 = this._getS3(overrides);
  }

  _getS3(overrides?): aws.S3 {
    const endpointSettings: aws.S3.ClientConfiguration = {};
    if (process.env.USE_LOCALSTACK === 'true') {
      aws.config.update({
        region: env.awsDefaultRegion,
        credentials: { accessKeyId: 'localstack', secretAccessKey: 'localstack' },
      });
      endpointSettings.endpoint = `http://${env.localstackHost}:4572`;
      endpointSettings.s3ForcePathStyle = true;
    }

    return new aws.S3({
      apiVersion: '2006-03-01',
      region: awsDefaultRegion,
      signatureVersion: 'v4',
      ...endpointSettings,
      ...overrides,
    });
  }

  /**
   * Returns an HTTPS URL that can be used to perform a GET on the given object
   * store URL
   *
   * @param objectUrl - the URL of the object to sign
   * @param params - an optional mapping of parameter key/values to put in the URL
   * @returns a signed URL
   * @throws TypeError - if the URL is not a recognized protocol or cannot be parsed
   */
  async signGetObject(objectUrl: string, params: { [key: string]: string }): Promise<string> {
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

    if (params && req.on) {
      req.on('build', () => { req.httpRequest.path += `?${querystring.stringify(params)}`; });
    }
    // TypeScript doesn't recognize that req has a presign method.  It does.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result = await (req as any).presign();
    // Needed as a work-around to allow access from outside the kubernetes cluster
    // for local development
    if (env.useLocalstack) {
      result = result.replace('localstack', 'localhost');
    }
    return result;
  }

  /**
   * Get an object from the object store (see AWS S3 SDK `getObject`)
   *
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @param callback - an optional callback function
   * @returns An object with a `promise` function that can be called to obtain a
   *   promise containing the retrieved object
   * @throws TypeError - if an invalid URL is supplied
   */
  getObject(
    paramsOrUrl: string | BucketParams,
    callback?: (err: aws.AWSError, data: aws.S3.GetObjectOutput) => void,
  ): aws.Request<aws.S3.GetObjectOutput, aws.AWSError> {
    return this.s3.getObject(this._paramsOrUrlToParams(paramsOrUrl), callback);
  }

  /**
   * Get the parsed JSON object for the JSON file at the given s3 location.
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the objects to
   *   be retrieved or the object URL
   * @returns an object, parsed from JSON
   */
  async getObjectJson(
    paramsOrUrl: string | BucketParams,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const catalogResponse = await this.getObject(paramsOrUrl).promise();
    const catalogString = catalogResponse.Body.toString('utf-8');
    return JSON.parse(catalogString);
  }

  /**
   * List all of the object keys for the given prefix.
   * 
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the objects to
   *   be retrieved or the object URL
   * @returns a promise resolving to a list of s3 object keys (strings)
   */
  async listObjectKeys(paramsOrUrl: string | BucketParams): Promise<string[]>  {
    let s3Objects = [];
    let hasMoreObjects = true;
    let continuationToken = null;
    const requestParams = this._paramsOrUrlToParams(paramsOrUrl);
    while (hasMoreObjects) {
      const res = await this.s3
        .listObjectsV2({
          Bucket: requestParams.Bucket,
          Prefix: requestParams.Key,
          ContinuationToken: continuationToken || undefined,
        })
        .promise();
      s3Objects = [...s3Objects, ...res.Contents.map(object => object.Key)];
      if (!res.IsTruncated) {
        hasMoreObjects = false;
        continuationToken = null;
      } else {
        continuationToken = res.NextContinuationToken;
      }
    }
    return s3Objects;
  }

  /**
   * Call HTTP HEAD on an object to get its headers without retrieving it (see AWS S3 SDK
   * `headObject`)
   *
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @returns A promise for the object's header to value pairs
   * @throws TypeError - if an invalid URL is supplied
   */
  headObject(
    paramsOrUrl: string | BucketParams,
  ): Promise<PromiseResult<aws.S3.HeadObjectOutput, aws.AWSError>> {
    return this.s3.headObject(this._paramsOrUrlToParams(paramsOrUrl)).promise();
  }

  /**
   * Check if the object exists.
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @returns a promise resolving to true if the object exists and false otherwise
   */
  async objectExists(paramsOrUrl: string | BucketParams): Promise<boolean> {
    try {
      await this.s3.headObject(this._paramsOrUrlToParams(paramsOrUrl)).promise();
      return true;
    } catch (err) {
      if (err.statusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Helper method for converting a param that is either S3 parameters (Bucket, Key, etc) or
   * a URL into a param that is S3 parameters.
   *
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @returns S3 parameters corresponding to the input
   * @throws TypeError - if an invalid URL is supplied
   */
  _paramsOrUrlToParams(paramsOrUrl: string | BucketParams): BucketParams {
    const params = paramsOrUrl;
    if (typeof params === 'string') {
      const match = params.match(new RegExp('s3://([^/]+)/(.*)'));
      if (!match) {
        throw new TypeError(`getObject string does not seem to be an S3 URL: ${params}`);
      }
      return { Bucket: match[1], Key: match[2] };
    }
    return params;
  }

  /**
   * Downloads the given object from the store, returning a string containing the contents of the
   * object
   *
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @returns a string containing the contents of the object
   * @throws TypeError - if an invalid URL is supplied
   */
  async download(paramsOrUrl: string | BucketParams): Promise<string> {
    const getObjectResponse = this.getObject(paramsOrUrl);
    return streamToString(getObjectResponse.createReadStream());
  }

  /**
   * Downloads the given object from the store, returning a temporary file location containing the
   * object.  Note, the caller MUST remove the file when complete
   *
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @returns path to a temporary file containing the object
   * @throws TypeError - if an invalid URL is supplied
   */
  async downloadFile(paramsOrUrl: string | BucketParams): Promise<string> {
    const tempFile = await createTmpFileName();
    const getObjectResponse = this.getObject(paramsOrUrl);
    await pipeline(getObjectResponse.createReadStream(), fs.createWriteStream(tempFile));
    return tempFile;
  }

  /**
   * Uploads the given file from the store, returning the URL to the uploaded file
   *
   * @param fileName - the path to the file to upload
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be uploaded or a URL location
   * @returns a URL to the uploaded file
   * @throws TypeError - if an invalid URL is supplied
   */
  async uploadFile(fileName: string, paramsOrUrl: string | BucketParams): Promise<string> {
    const fileContent = await readFile(fileName);
    const params = this._paramsOrUrlToParams(paramsOrUrl) as aws.S3.PutObjectRequest;
    params.Body = fileContent;
    await this.s3.upload(params).promise();
    return this.getUrlString(params.Bucket, params.Key);
  }

  /**
   * Stream upload an object to S3 (see AWS S3 SDK `upload`)
   *
   * @param stringOrStream - the text string or stream to upload
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be uploaded or a URL location
   * @param contentLength - The length of the stream, required if a stream is provided
   * @param contentType - The content type to associate with the object
   * @returns The response from the store
   * @throws TypeError - if an invalid URL is supplied or contentLength is not supplied
   */
  async upload(
    stringOrStream: string | NodeJS.ReadableStream,
    paramsOrUrl: string | BucketParams,
    contentLength: number = null,
    contentType: string = null,
  ): Promise<aws.S3.ManagedUpload.SendData> {
    const params = this._paramsOrUrlToParams(paramsOrUrl) as aws.S3.PutObjectRequest;

    const body = stringOrStream;
    const isStream = typeof body !== 'string';

    let srcStream;
    if (isStream) {
      if (contentLength === null) {
        throw new TypeError('Content length must be provided when a stream is supplied');
      }
      params.ContentLength = contentLength;
      // Getting non-zero-byte files streaming a req to S3 is wonky
      // https://stackoverflow.com/a/54153557
      srcStream = new stream.PassThrough();
      (body as NodeJS.ReadableStream).pipe(srcStream);
      params.Body = new stream.PassThrough();
    } else {
      params.Body = body;
    }

    if (contentType) {
      params.Metadata = params.Metadata || {};
      params.Metadata['Content-Type'] = contentType; // Helps tests
      params.ContentType = contentType;
    }
    const upload = this.s3.upload(params);
    if (isStream) {
      const passthrough = params.Body as stream.PassThrough;
      srcStream.on('data', (chunk) => { passthrough.write(chunk); });
      srcStream.on('end', () => { passthrough.end(); });
    }
    return upload.promise();
  }

  /**
   * Returns a URL string for an object with the given bucket and key (prefix)
   *
   * @param bucket - the bucket containing the URL to construct
   * @param key - the key or key prefix for the location
   * @returns the URL for the object
   */
  getUrlString(bucket: string, key: string): string {
    return `s3://${bucket}/${key}`;
  }

  /**
   * Changes ownership of the provided object to the harmony account
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to be retrieved or
   *   the object URL
   */
  async _changeOwnership(paramsOrUrl: string | BucketParams): Promise<void> {
    const params = this._paramsOrUrlToParams(paramsOrUrl);
    const existingObject = await this.headObject(params);
    // When replacing the metadata both the Metadata and ContentType fields are overwritten
    // with the new object creation. So we preserve those two fields here.
    const copyObjectParams = {
      ...params,
      Metadata: await existingObject.Metadata,
      ContentType: await existingObject.ContentType,
      MetadataDirective: 'REPLACE',
      CopySource: `${params.Bucket}/${params.Key}`,
    };
    await this.s3.copyObject(copyObjectParams).promise();
  }
}

/**
 * Returns a class to interact with the object store appropriate for
 * the provided protocol, or null if no such store exists.
 *
 * @param protocol - the protocol used in object store URLs.  This may be a full URL, in
 *   which case the protocol will be read from the front of the URL.
 * @returns an object store for interacting with the given protocol
 */
export function objectStoreForProtocol(protocol?: string): S3ObjectStore {
  if (!protocol) {
    return null;
  }
  // Make sure the protocol is lowercase and does not end in a colon (as URL parsing produces)
  const normalizedProtocol = protocol.toLowerCase().split(':')[0];
  if (normalizedProtocol === 's3') {
    return new S3ObjectStore({});
  }
  return null;
}

/**
 * Returns the default object store for this instance of Harmony.  Allows requesting an
 * object store without first knowing a protocol.
 *
 * @returns the default object store for Harmony.
 */
export function defaultObjectStore(): S3ObjectStore {
  return new S3ObjectStore({});
}
