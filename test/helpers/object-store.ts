import { before, after } from 'mocha';
import sinon from 'sinon';
import fs from 'fs';
import mockAws from 'mock-aws-s3';
import * as tmp from 'tmp';
import { S3ObjectStore } from 'util/object-store';

// Patches mock-aws-s3's mock so that the result of "upload" has an "on" method
const S3MockPrototype = Object.getPrototypeOf(new mockAws.S3());
const originalUpload = S3MockPrototype.upload;
S3MockPrototype.upload = function (...args): any {
  const result = originalUpload.call(this, ...args);
  return { on: (): any => {}, ...result };
};

/**
 * Causes calls to aws.S3 to return a mock S3 object that stores to a temp dir on the
 * local filesystem.
 *
 * @param {string[]} _buckets An optional list of buckets to create in the mock S3 (not implemented
 * yet)
 * @returns {void}
 */
export function hookMockS3(_buckets?: string[]): void {
  let dir;
  let stub;
  before(async function () {
    dir = tmp.dirSync();
    mockAws.config.basePath = dir.name;
    stub = sinon.stub(S3ObjectStore.prototype, '_getS3')
      .callsFake(() => new mockAws.S3());
  });

  after(function () {
    stub.restore();
    dir.removeCallback();
  });
}

/**
 * Adds stubs to S3 object signing that retain the username from the 'A-userid' parameter.
 *
 * @returns {string} The URL prefix for use in matching responses
 */
export function hookSignS3Object(): string {
  const prefix = 'https://example.com/s3/signed/';
  before(function () {
    sinon.stub(S3ObjectStore.prototype, 'signGetObject')
      .callsFake(async (url, params) => `${prefix}${params['A-userid']}`);
  });
  after(function () {
    (S3ObjectStore.prototype.signGetObject as any).restore();
  });
  return prefix;
}

/**
 * Gets JSON from the given object store URL.  Uses synchronous functions only suitable for testing
 * @param {string} url the Object store URL to get
 * @returns {*} the JSON contents of the file at the given URL
 */
export async function getJson(url: string): Promise<any> {
  const objectStore = new S3ObjectStore();
  const filename = await objectStore.downloadFile(url);
  try {
    return JSON.parse(fs.readFileSync(filename).toString());
  } finally {
    fs.unlinkSync(filename);
  }
}
