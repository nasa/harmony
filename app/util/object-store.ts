import * as fs from 'fs';
import * as querystring from 'querystring';
import * as stream from 'stream';
import tmp from 'tmp';
import { URL } from 'url';
import * as util from 'util';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CopyObjectCommand, GetBucketLocationCommand, GetObjectCommand, GetObjectCommandOutput,
  HeadObjectCommand, HeadObjectCommandOutput, ListObjectsV2Command, PutObjectCommand,
  PutObjectCommandInput, PutObjectCommandOutput, S3Client, S3ClientConfig,
} from '@aws-sdk/client-s3';

import env = require('./env');
const { awsDefaultRegion } = env;

const pipeline = util.promisify(stream.pipeline);
const createTmpFileName = util.promisify(tmp.tmpName);
const readFile = util.promisify(fs.readFile);

export interface BucketParams {
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
  s3: S3Client;

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


  _getS3(overrides?: S3ClientConfig): S3Client {
    console.log('CDD IN _getS3');
    if (process.env.USE_LOCALSTACK === 'true') {
      console.log('CDD use localstack is true');
      const { localstackHost } = env;

      const endpointSettings = {
        endpoint: `http://${localstackHost}:4572`,
        forcePathStyle: true,
      };

      const credentials = {
        accessKeyId: 'localstack',
        secretAccessKey: 'localstack',
      };

      return new S3Client({
        apiVersion: '2006-03-01',
        region: awsDefaultRegion,
        ...endpointSettings,
        ...overrides,
        credentials,
      });
    }

    console.log('CDD Should not have gotten here - not using localstack');

    return new S3Client({
      apiVersion: '2006-03-01',
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
      Key: url.pathname.substr(1).replaceAll('%20', ' '), // Nuke leading "/" and convert %20 to spaces
    };

    try {
      console.log(`CDD: Object is ${JSON.stringify(object)}`);
      // Verifies that the object exists, or throws NotFound
      await this.s3.send(new HeadObjectCommand(object));

      console.log('CDD - head command worked');

      const req = new GetObjectCommand(object);

      console.log('CDD - Get command worked');

      let signedUrl = await getSignedUrl(this.s3, req, { expiresIn: 3600 }); // Adjust expiresIn value as needed

      console.log(`CDD - signed url worked - URL is ${signedUrl}`);

      // Needed as a work-around to allow access from outside the Kubernetes cluster
      // for local development
      if (env.useLocalstack) {
        signedUrl = signedUrl.replace('localstack', 'localhost');
      }

      // Add query parameters to string
      if (params) {
        signedUrl = signedUrl.replace('?', `?${querystring.stringify(params)}&`);
      }

      console.log(`CDD - signed url after replacement - URL is ${signedUrl}`);

      return signedUrl;
    } catch (error) {
      // Handle any errors that occur during the headObject or getObject requests
      console.log(`CDD - something was thrown ${error.message}`);
      throw error;
    }
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
    callback?: (err, data: GetObjectCommandOutput) => void,
  ): Promise<GetObjectCommandOutput> {
    const params = this._paramsOrUrlToParams(paramsOrUrl);
    const command = new GetObjectCommand(params);

    if (callback) {
      this.s3.send(command)
        .then((response) => callback(null, response))
        .catch((error) => callback(error, null));
    } else {
      return this.s3.send(command);
    }
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
    const catalogResponse = await this.getObject(paramsOrUrl);
    // console.log(`CDD: Response was ${JSON.stringify(catalogResponse)}`);
    const catalogString = await catalogResponse.Body.transformToString();
    return JSON.parse(catalogString);
  }

  /**
   * List all of the object keys for the given prefix.
   *
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the objects to
   *   be retrieved or the object URL
   * @returns a promise resolving to a list of s3 object keys (strings)
   */
  async listObjectKeys(paramsOrUrl: string | BucketParams): Promise<string[]> {
    const s3Objects: string[] = [];
    let hasMoreObjects = true;
    let continuationToken: string | undefined = undefined;
    const requestParams = this._paramsOrUrlToParams(paramsOrUrl);

    while (hasMoreObjects) {
      const command = new ListObjectsV2Command({
        Bucket: requestParams.Bucket,
        Prefix: requestParams.Key,
        ContinuationToken: continuationToken,
      });
      const response = await this.s3.send(command);

      s3Objects.push(...(response.Contents?.map(object => object.Key) ?? []));

      if (!response.IsTruncated) {
        hasMoreObjects = false;
        continuationToken = undefined;
      } else {
        continuationToken = response.NextContinuationToken;
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
  async headObject(paramsOrUrl: string | BucketParams): Promise<HeadObjectCommandOutput> {
    const command = new HeadObjectCommand(this._paramsOrUrlToParams(paramsOrUrl));
    return this.s3.send(command);
  }

  /**
   * Check if the object exists.
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @returns a promise resolving to true if the object exists and false otherwise
   */
  async objectExists(paramsOrUrl: string | BucketParams): Promise<boolean> {
    try {
      await this.headObject(paramsOrUrl);
      return true;
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 404) {
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
    const getObjectCommand = new GetObjectCommand(this._paramsOrUrlToParams(paramsOrUrl));
    const getObjectResponse = await this.s3.send(getObjectCommand);
    const body = getObjectResponse.Body;

    if (body && typeof body === 'object') {
      const buffer = await streamToString(body as stream.Readable);
      return buffer.toString();
    }

    throw new Error('Failed to download object');
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
    const getObjectResponse = await this.getObject(paramsOrUrl);
    await pipeline(getObjectResponse.Body as stream.Readable, fs.createWriteStream(tempFile));
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
    const params = this._paramsOrUrlToParams(paramsOrUrl) as PutObjectCommandInput;
    params.Body = fileContent;

    const uploadCommand = new PutObjectCommand(params);
    await this.s3.send(uploadCommand);

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
  ): Promise<PutObjectCommandOutput> {
    const params = this._paramsOrUrlToParams(paramsOrUrl) as PutObjectCommandInput;

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
      srcStream = new stream.Readable();
      (body as NodeJS.ReadableStream).on('data', (chunk) => {
        srcStream.push(chunk);
      });
      (body as NodeJS.ReadableStream).on('end', () => {
        srcStream.push(null);
      });
      params.Body = srcStream;
    } else {
      params.Body = body;
    }

    if (contentType) {
      params.Metadata = params.Metadata || {};
      params.Metadata['Content-Type'] = contentType; // Helps tests
      params.ContentType = contentType;
    }

    const putObjectCommand = new PutObjectCommand(params);
    console.log(`This.s3 is ${JSON.stringify(this.s3)}`);

    const response = await this.s3.send(putObjectCommand);

    return response;
  }



  /**
   * Returns the AWS region the given bucket is in
   *
   * @param bucketName - name of the s3 bucket
   * @returns the AWS region
   */
  async getBucketRegion(bucketName: string): Promise<string> {
    const command = new GetBucketLocationCommand({ Bucket: bucketName });
    const response = await this.s3.send(command);

    // AWS returns null when the bucket region is us-east-1. We always want to return a region name.
    return response.LocationConstraint ?? 'us-east-1';
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
  async changeOwnership(s3: S3Client, paramsOrUrl: string | BucketParams): Promise<void> {
    const params = this._paramsOrUrlToParams(paramsOrUrl);
    const existingObject = await this.headObject(params);

    // When replacing the metadata, both the Metadata and ContentType fields are overwritten
    // with the new object creation. So we preserve those two fields here.
    const copyObjectParams = {
      ...params,
      Metadata: existingObject.Metadata,
      ContentType: existingObject.ContentType,
      MetadataDirective: 'REPLACE',
      CopySource: `${params.Bucket}/${params.Key}`,
    };

    const command = new CopyObjectCommand(copyObjectParams);
    await s3.send(command);
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
