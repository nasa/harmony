import * as tmp from 'tmp';
import { FileStore } from '../../app/util/object-store/file-store';
import * as objectStore from '../../app/util/object-store';
import { stub } from 'sinon';

/**
 * Causes calls to aws.S3 to return a mock S3 object that stores to a temp dir on the
 * local filesystem.
 */
export function hookMockS3(): void {
  let stubDefaultObjectStore;
  let stubObjectStoreForProtocol;
  let dir;
  let fileStore;

  before(function () {
    dir = tmp.dirSync({ unsafeCleanup: true });
    fileStore = new FileStore(dir.name);
    stubDefaultObjectStore = stub(objectStore, 'defaultObjectStore').callsFake(() => fileStore);
    stubObjectStoreForProtocol = stub(objectStore, 'objectStoreForProtocol').callsFake(() => fileStore);
  });

  after(function () {
    stubDefaultObjectStore.restore();
    stubObjectStoreForProtocol.restore();
    dir.removeCallback();
  });
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