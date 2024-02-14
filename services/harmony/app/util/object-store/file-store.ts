/**
 * This file adds an implementation of the ObjectStore protocol for saving files to a local
 * file system as opposed to S3. It is currently used to replace S3 interactions in tests.
 */
import { HeadObjectResponse, MulterFile, ObjectStore } from './object-store';
import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';
import * as util from 'util';


const pipeline = util.promisify(stream.pipeline);

/**
 * Class to use when interacting with files instead of S3. Used for testing, but could also
 * be used in place of an S3 store for the harmony application if it was running only one
 * frontend instance.
 */
export class FileStore implements ObjectStore {

  fileStoreRoot;

  /**
   * Builds and returns a file store object
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
    return paramsOrUrl.replace('s3://', `${this.fileStoreRoot}/`);
  }

  signGetObject(objectUrl: string, params: { [key: string]: string }): Promise<string> {
    let signedUrl = objectUrl;
    if (params) {
      const queryString = new URLSearchParams(params).toString();
      signedUrl = `${objectUrl}?${queryString}`;
    }
    signedUrl = signedUrl.replace('s3://', 'https://');
    return Promise.resolve(signedUrl);
  }

  getObject(paramsOrUrl: string | object): Promise<string> {
    return Promise.resolve(fs.readFileSync(this._getFilename(paramsOrUrl), 'utf8'));
  }

  async getObjectJson(paramsOrUrl: string | object): Promise<object> {
    const object = await this.getObject(paramsOrUrl);
    return JSON.parse(object);
  }

  listObjectKeys(paramsOrUrl: string | object): Promise<string[]> {
    try {
      let prefix = '';
      if (typeof paramsOrUrl === 'string') {
        prefix = paramsOrUrl.match(/s3:\/\/.*?\/(.*)\//)[1];
      }
      const files = fs.readdirSync(this._getFilename(paramsOrUrl));
      return Promise.resolve(files.map((file) => `${prefix}/${file}`));
    } catch (e) {
      return Promise.resolve([]);
    }
  }

  async headObject(paramsOrUrl: string | object): Promise<HeadObjectResponse> {
    const filename = this._getFilename(paramsOrUrl);
    let contentType;
    if (await this.objectExists(filename + 'content-type')) {
      contentType = await this.getObject(filename + 'content-type');
    }
    const stats = fs.statSync(filename);
    return Promise.resolve({ contentLength: stats.size, contentType });
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
    _contentLength?: number,
    contentType?: string,
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
    if (contentType) {
      fs.writeFileSync(filename + 'content-type', contentType);
    }
    return Promise.resolve({});
  }

  getBucketRegion(_bucketName: string): Promise<string> {
    return Promise.resolve('us-west-2');
  }

  getUrlString(mFile: MulterFile): string {
    const { bucket, key } = mFile;
    if (bucket && key) {
      return this.fileStoreRoot + bucket + key;
    } else {
      return mFile.path;
    }
  }

  changeOwnership(_paramsOrUrl: string | object): Promise<void> {
    // Not implemented
    return Promise.resolve();
  }
}
