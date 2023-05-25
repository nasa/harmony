// import { stub, SinonStub } from 'sinon';
// import fs from 'fs';
// import mockAws from 'mock-aws-s3';
import * as tmp from 'tmp';
// import { S3ObjectStore, BucketParams } from '../../app/util/object-store/s3-object-store';
// import { PutObjectCommandOutput, S3Client } from '@aws-sdk/client-s3';

import { FileStore } from '../../app/util/object-store/file-store';
import * as objectStore from '../../app/util/object-store';
import { stub } from 'sinon';

// // Patches mock-aws-s3's mock so that the result of "upload" has an "on" method
// // const S3MockPrototype = Object.getPrototypeOf(new mockAws.S3());
// // const originalUpload = S3MockPrototype.upload;
// // S3MockPrototype.upload = function (...args): mockAws.S3.ManagedUpload {
// //   const result = originalUpload.call(this, ...args);
// //   return { on: (): void => {}, ...result };
// // };

// /**
//  * Adds stubs to S3 object signing that retain the username from the 'A-userid' parameter.
//  *
//  * @returns The URL prefix for use in matching responses
//  */
// export function hookSignS3Object(): string {
//   const prefix = 'https://example.com/s3/signed/';
//   before(function () {
//     stub(S3ObjectStore.prototype, 'signGetObject')
//       .callsFake(async (url, params) => `${prefix}${params['A-userid']}`);
//   });
//   after(function () {
//     (S3ObjectStore.prototype.signGetObject as SinonStub).restore();
//   });
//   return prefix;
// }

// /**
//  * Gets JSON from the given object store URL.  Uses synchronous functions only suitable for testing.
//  * If using mock-aws-s3, use getObjectText below
//  * @param url - the Object store URL to get
//  * @returns the JSON contents of the file at the given URL
//  */
// export async function getJson(url: string):
// Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
//   const objectStore = new S3ObjectStore();
//   const filename = await objectStore.downloadFile(url);
//   try {
//     return JSON.parse(fs.readFileSync(filename).toString());
//   } finally {
//     fs.unlinkSync(filename);
//   }
// }

// /**
//  * Returns the text contents of the object at the provided URL.  If the object is mocked using
//  * mock-aws-s3 this is likely to produce better results than `getJson` above.
//  * @param url - the Object store URL to read
//  */
// export async function getObjectText(url: string): Promise<string> {
//   const objectStore = new S3ObjectStore();
//   const filename = await objectStore.downloadFile(url);
//   try {
//     return fs.readFileSync(filename).toString();
//   } finally {
//     fs.unlinkSync(filename);
//   }
//   // const contents: GetObjectCommandOutput = await new Promise((resolve, reject) => {
//   //   void objectStoreForProtocol(url).getObject(url, (err, body) => {
//   //     if (err) reject(err);
//   //     else resolve(body);
//   //   });
//   // });
//   // return contents.Body.toString();
// }

// Override using S3 in tests
const dir = tmp.dirSync({ unsafeCleanup: true });
const fileStore = new FileStore(dir.name);
stub(objectStore, 'defaultObjectStore').callsFake(() => fileStore);
stub(objectStore, 'objectStoreForProtocol').callsFake(() => fileStore);


/**
 * Causes calls to aws.S3 to return a mock S3 object that stores to a temp dir on the
 * local filesystem.
 *
 * @param _buckets - An optional list of buckets to create in the mock S3 (not implemented
 * yet)
 */
export function hookMockS3(_buckets?: string[]): void {
  // let dir;
  // let stubDefaultObjectStore;
  // let stubObjectStoreForProtocol;
  // let fileStore;
  // before(function () {
  //   dir = tmp.dirSync({ unsafeCleanup: true });
  //   fileStore = new FileStore(dir);

  //   stubDefaultObjectStore = stub(objectStore, 'defaultObjectStore').callsFake(() => fileStore);
  //   stubObjectStoreForProtocol = stub(objectStore, 'objectStoreForProtocol').callsFake(() => fileStore);
  // });

  // after(function () {
  //   stubDefaultObjectStore.restore();
  //   stubObjectStoreForProtocol.restore();
  //   dir.removeCallback();
  // });
}

/**
 * Adds before / after hooks to GetBucketRegion
 *
 * @param region - The bucket region to return
 */
export function hookGetBucketRegion(
  region: string): void {
  let stubGetBucketRegion;
  before(function () {
    // replace getBucketRegion since getBucketLocation is not supported in mock-aws-s3
    stubGetBucketRegion = stub(FileStore.prototype, 'getBucketRegion')
      .callsFake(async (bucketName: string) => {
        if (bucketName === 'non-existent-bucket') {
          const e = new Error('The specified bucket does not exist');
          e.name = 'NoSuchBucket';
          throw e;
        } else if (bucketName === 'no-permission') {
          const e = new Error('Access Denied');
          e.name = 'AccessDenied';
          throw e;
        } else if (bucketName === 'invalid,bucket') {
          const e = new Error('The specified bucket is not valid.');
          e.name = 'InvalidBucketName';
          throw e;
        } else {
          return region;
        }
      });
  });

  after(function () {
    stubGetBucketRegion.restore();
  });
}

/**
 * Adds before / after hooks to upload
 */
export function hookUpload(): void {
  let stubUpload;
  before(function () {
    stubUpload = stub(FileStore.prototype, 'upload')
      .callsFake((stringOrStream,
        destinationUrl,
        _contentLength,
        _contentType) : Promise<object> => {
        const destUrl = typeof destinationUrl === 'string' ? destinationUrl : '';
        if (destUrl.startsWith('s3://no-write-permission')) {
          const e = new Error('Access Denied');
          e.name = 'AccessDenied';
          throw e;
        }
        return null;
      });
  });

  after(function () {
    stubUpload.restore();
  });
}