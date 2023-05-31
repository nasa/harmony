import { HeadObjectResponse, MulterFile, ObjectStore } from './object-store';
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
    // console.log(`Passed in filename was ${paramsOrUrl}`);
    return paramsOrUrl.replace('s3://', `${this.fileStoreRoot}/`);
  }

  /**
   * Returns the filename represented by the passed in parameters
   * @param paramsOrUrl - a map of parameters (Bucket, Key) or a string URL
   * @returns
   */
  // _getFilename2(paramsOrUrl, contentType?): string {
  //   // s3://local-artifact-bucket/harmony-inputs/query/8506b5cb-0a61-4796-8cdf-9944a4c72bc3/query00000.json
  //   // let fileName = paramsOrUrl;
  //   // if (paramsOrUrl.startsWith('s3://')) {
  //   //   fileName = fileName.replace('s3://', this.fileStoreRoot + '/');
  //   // }
  //   // return fileName;
  //   let filename: string = paramsOrUrl.replace('s3://', `${this.fileStoreRoot}/`);
  //   if (contentType) {
  //     filename = filename.concat(encodeURIComponent(`ct-${contentType}`));
  //   }
  //   return filename;
  // }

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
    // console.log(`trying to find object ${paramsOrUrl}`);
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
    // console.log(`Attempting to upload ${paramsOrUrl}`);
    const filename = this._getFilename(paramsOrUrl);
    // console.log(`File name is ${filename}`);

    const dirname = path.dirname(filename);
    // console.log(`Dir name is ${dirname}`);

    const dirExists = await this.objectExists(dirname);
    // console.log(`Dir exists is ${dirExists}`);

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
    // console.log(`Wrote file ${filename}`);
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
    return Promise.resolve();
  }
}


