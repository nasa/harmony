import { HeadObjectResponse, ObjectStore } from './object-store';
import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';
import * as util from 'util';


const pipeline = util.promisify(stream.pipeline);

/**
 * Class to use when interacting with files instead of S3. Used for testing.
 *
 */
export class FileStore implements ObjectStore {

  fileStoreRoot;

  /**
   * Builds and returns an file store
   *
   * @param root - root directory to store files
   */
  constructor(root = '/tmp') {
    this.fileStoreRoot = root;
  }

  /**
   * Returns the filename represented by the passed in parameters
   * @param paramsOrUrl - a map of parameters (Bucket, Key) or a string URL
   * @returns
   */
  _getFilename(paramsOrUrl): string {
    // s3://local-artifact-bucket/harmony-inputs/query/8506b5cb-0a61-4796-8cdf-9944a4c72bc3/query00000.json
    // let fileName = paramsOrUrl;
    // if (paramsOrUrl.startsWith('s3://')) {
    //   fileName = fileName.replace('s3://', this.fileStoreRoot + '/');
    // }
    // return fileName;
    return paramsOrUrl.replace('s3://', this.fileStoreRoot + '/');
  }

  signGetObject(objectUrl: string, _params: { [key: string]: string }): Promise<string> {
    return Promise.resolve(objectUrl);
  }

  getObject(paramsOrUrl: string | object): Promise<string> {
    return Promise.resolve(fs.readFileSync(this._getFilename(paramsOrUrl), 'utf8'));
  }

  async getObjectJson(paramsOrUrl: string | object): Promise<object> {
    const object = await this.getObject(paramsOrUrl);
    return JSON.parse(object);
  }

  listObjectKeys(paramsOrUrl: string | object): Promise<string[]> {
    const files = fs.readdirSync(this._getFilename(paramsOrUrl));
    return Promise.resolve(files);
  }

  headObject(paramsOrUrl: string | object): Promise<HeadObjectResponse> {
    const stats = fs.statSync(this._getFilename(paramsOrUrl));
    return Promise.resolve({ contentLength: stats.size });
  }

  objectExists(paramsOrUrl: string | object): Promise<boolean> {
    try {
      fs.statSync(this._getFilename(paramsOrUrl));
      return Promise.resolve(true);
    } catch (error) {
      return Promise.resolve(false);
    }
  }

  downloadFile(paramsOrUrl: string | object): Promise<string> {
    return Promise.resolve(paramsOrUrl as string);
  }

  async uploadFile(fileName: string, paramsOrUrl: string | object): Promise<string> {
    const newFileName = this._getFilename(paramsOrUrl);
    const dirname = path.dirname(newFileName);
    const dirExists = await this.objectExists(dirname);
    if (!dirExists) {
      fs.mkdirSync(dirname, { recursive: true });
    }
    fs.copyFileSync(fileName, newFileName);
    return Promise.resolve(newFileName);
  }

  async upload(
    stringOrStream: string | NodeJS.ReadableStream,
    paramsOrUrl: string | object,
    _contentLength: number,
    _contentType: string,
  ): Promise<object> {
    const filename = this._getFilename(paramsOrUrl);
    const dirname = path.dirname(filename);
    const dirExists = await this.objectExists(dirname);
    if (!dirExists) {
      fs.mkdirSync(dirname, { recursive: true });
    }
    const isStream = typeof stringOrStream !== 'string';
    if (isStream) {
      await pipeline(stringOrStream as stream.Readable, fs.createWriteStream(filename));
    } else {
      fs.writeFileSync(filename, stringOrStream);
    }
    return Promise.resolve({});
  }

  getBucketRegion(_bucketName: string): Promise<string> {
    return Promise.resolve('us-west-2');
  }

  getUrlString(bucket: string, key: string): string {
    return this.fileStoreRoot + bucket + key;
  }

  changeOwnership(_paramsOrUrl: string | object): Promise<void> {
    return Promise.resolve();
  }
}


