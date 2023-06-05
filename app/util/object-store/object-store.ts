/**
 * The object store protocol is an implementation that wraps many common AWS S3
 * functions into our own API. By doing this code does not need to be changed
 * in order to interact with something other than S3 for object (file) storage.
 * We have two implementations of this protocol right now - S3ObjectStore and
 * FileStore.
 */

export interface HeadObjectResponse {
  contentLength: number;
  contentType?: string;
}

export interface MulterFile {
  key?: string;
  bucket?: string;
  path?: string;
}

export abstract class ObjectStore {
  abstract signGetObject(objectUrl: string, params: { [key: string]: string }): Promise<string>;
  abstract getObject(paramsOrUrl: string | object): Promise<string>;
  abstract getObjectJson(paramsOrUrl: string | object): Promise<object>;
  abstract listObjectKeys(paramsOrUrl: string | object): Promise<string[]>;
  abstract headObject(paramsOrUrl: string | object): Promise<HeadObjectResponse>;
  abstract objectExists(paramsOrUrl: string | object): Promise<boolean>;
  abstract downloadFile(paramsOrUrl: string | object): Promise<string>;
  abstract uploadFile(fileName: string, paramsOrUrl: string | object): Promise<string>;
  abstract upload(
    stringOrStream: string | NodeJS.ReadableStream,
    paramsOrUrl: string | object,
    contentLength?: number,
    contentType?: string,
  ): Promise<object>;
  abstract getBucketRegion(bucketName: string): Promise<string>;
  abstract getUrlString(mFile: MulterFile);
  abstract changeOwnership(paramsOrUrl: string | object): Promise<void>;
}
