import { getSignedUrl, S3RequestPresigner, S3RequestPresignerOptions } from '@aws-sdk/s3-request-presigner';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { parseUrl } from '@aws-sdk/url-parser';
import { Hash } from '@aws-sdk/hash-node';
import { formatUrl } from '@aws-sdk/util-format-url';

import { CopyObjectCommand, GetBucketLocationCommand, GetObjectCommand,
  HeadObjectCommand, ListObjectsV2Command, PutObjectCommand,
  PutObjectCommandInput, PutObjectCommandOutput, S3Client, S3ClientConfig,
} from '@aws-sdk/client-s3';

import { fromInstanceMetadata } from '@aws-sdk/credential-provider-imds';

import { env } from '@harmony/util';
const { awsDefaultRegion } = env;

import * as fs from 'fs';
import tmp from 'tmp';
import * as util from 'util';
import * as stream from 'stream';
import { HeadObjectResponse, MulterFile, ObjectStore } from './object-store';

const pipeline = util.promisify(stream.pipeline);
const createTmpFileName = util.promisify(tmp.tmpName);
const readFile = util.promisify(fs.readFile);

export interface BucketParams {
  Bucket: string;
  Key: string;
}

/**
 * Class to use when interacting with S3
 *
 */
export class S3ObjectStore implements ObjectStore {
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

  _getS3Config(overrides?: object): object {
    let config = {};
    if (process.env.USE_LOCALSTACK === 'true') {
      const { localstackHost } = env;

      const endpointSettings = {
        endpoint: `http://${localstackHost}:4572`,
        forcePathStyle: true,
      };

      process.env.AWS_ACCESS_KEY_ID = 'localstack';
      process.env.AWS_SECRET_ACCESS_KEY = 'localstack';

      config = {
        apiVersion: '2006-03-01',
        credentials: {
          accessKeyId: 'localstack',
          secretAccessKey: 'localstack',
        },
        region: awsDefaultRegion,
        ...endpointSettings,
        ...overrides,
      };
    } else {
      config = {
        apiVersion: '2006-03-01',
        region: awsDefaultRegion,
        credentials: fromInstanceMetadata(),
        ...overrides,
      };
    }

    return config;
  }

  _getS3(overrides?: S3ClientConfig): S3Client {
    return new S3Client(this._getS3Config(overrides));
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
    const config = this._getS3Config() as S3RequestPresignerOptions;
    const presigner = new S3RequestPresigner({
      sha256: Hash.bind(null, 'sha256'), // In Node.js
      ...config,
    });

    const url = new URL(objectUrl);
    if (url.protocol.toLowerCase() !== 's3:') {
      throw new TypeError(`Invalid S3 URL: ${objectUrl}`);
    }
    const object = {
      Bucket: url.hostname,
      Key: url.pathname.substr(1).replaceAll('%20', ' '), // Nuke leading "/" and convert %20 to spaces
      QueryParameters: params,
    };

    // Verifies that the object exists, or throws NotFound
    await this.s3.send(new HeadObjectCommand(object));
    const req = new GetObjectCommand(object);
    const signedUrl = await getSignedUrl(this.s3, req, { expiresIn: 3600 });
    const baseUrl = signedUrl.substring(0, signedUrl.indexOf('?'));
    const urlToSign = parseUrl(baseUrl);
    urlToSign.query = params;
    const urlNew = await presigner.presign(new HttpRequest(urlToSign), { expiresIn: 3600 });


    let finalUrl = formatUrl(urlNew);
    // Needed as a work-around to allow access from outside the kubernetes cluster
    // for local development
    if (env.useLocalstack) {
      finalUrl = finalUrl.replace('localstack', 'localhost');
    }
    return finalUrl;
  }

  /**
   * Get an object from S3 returning a string containing the contents
   *
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @param callback - an optional callback function
   * @returns An object with a `promise` function that can be called to obtain a
   *   promise containing the retrieved object
   * @throws TypeError - if an invalid URL is supplied
   */
  async getObject(
    paramsOrUrl: string | BucketParams,
  ): Promise<string> {
    const params = this._paramsOrUrlToParams(paramsOrUrl);
    const command = new GetObjectCommand(params);

    const response = await this.s3.send(command);
    const objectAsString = await response.Body.transformToString();
    return objectAsString;
  }

  /**
   * Get an object from S3 returning a string containing the contents
   *
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to
   *   be retrieved or the object URL
   * @param callback - an optional callback function
   * @returns An object with a `promise` function that can be called to obtain a
   *   promise containing the retrieved object
   * @throws TypeError - if an invalid URL is supplied
   */
  async _getObjectStream(
    paramsOrUrl: string | BucketParams,
  ): Promise<object> {
    const params = this._paramsOrUrlToParams(paramsOrUrl);
    const command = new GetObjectCommand(params);

    const response = await this.s3.send(command);
    return response.Body;
  }


  /**
   * Get the parsed JSON object for the JSON file at the given s3 location.
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the objects to
   *   be retrieved or the object URL
   * @returns an object, parsed from JSON
   */
  async getObjectJson(
    paramsOrUrl: string | BucketParams,
  ): Promise<object> {
    const contents = await this.getObject(paramsOrUrl);
    return JSON.parse(contents);
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
  async headObject(paramsOrUrl: string | BucketParams): Promise<HeadObjectResponse> {
    const command = new HeadObjectCommand(this._paramsOrUrlToParams(paramsOrUrl));
    const response = await this.s3.send(command);
    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
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
    const objectStream = await this._getObjectStream(paramsOrUrl);
    await pipeline(objectStream as stream.Readable, fs.createWriteStream(tempFile));
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

    return this.getUrlString({ bucket: params.Bucket, key: params.Key });
  }


  /**
   * Stream upload an object to S3
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
  getUrlString(mFile: MulterFile): string {
    const { bucket, key } = mFile;
    return `s3://${bucket}/${key}`;
  }

  /**
   * Changes ownership of the provided object to the harmony account
   * @param paramsOrUrl - a map of parameters (Bucket, Key) indicating the object to be retrieved or
   *   the object URL
   */
  async changeOwnership(paramsOrUrl: string | BucketParams): Promise<void> {
    const params = this._paramsOrUrlToParams(paramsOrUrl);
    const headCommand = new HeadObjectCommand(this._paramsOrUrlToParams(paramsOrUrl));
    const existingObject = await this.s3.send(headCommand);

    // When replacing the metadata, both the Metadata and ContentType fields are overwritten
    // with the new object creation. So we preserve those two fields here.
    const copyObjectParams = {
      ...params,
      Metadata: existingObject.Metadata,
      ContentType: existingObject.ContentType,
      MetadataDirective: 'REPLACE',
      CopySource: `${params.Bucket}/${params.Key}`,
    };

    const copyCommand = new CopyObjectCommand(copyObjectParams);
    await this.s3.send(copyCommand);
  }
}
