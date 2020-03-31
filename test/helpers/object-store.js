const { before, after } = require('mocha');
const sinon = require('sinon');
const aws = require('aws-sdk');
const mockAws = require('mock-aws-s3');
const fs = require('fs');
const path = require('path');
const tmp = require('tmp');
const { S3ObjectStore } = require('../../app/util/object-store');

// Patches mock-aws-s3's mock so that the result of "upload" has an "on" method
const S3MockPrototype = Object.getPrototypeOf(new mockAws.S3());
const originalUpload = S3MockPrototype.upload;
S3MockPrototype.upload = function (...args) {
  const result = originalUpload.call(this, ...args);
  return {
    on: () => {},
    ...result,
  };
};

/**
 * Causes calls to aws.S3 to return a mock S3 object that stores to a temp dir on the
 * local filesystem.
 *
 * @param {string[]} _buckets An optional list of buckets to create in the mock S3 (not implemented
 * yet)
 * @returns {void}
 */
function hookMockS3(_buckets) {
  const s3 = aws.S3;
  let dir;
  before(async function () {
    dir = tmp.dirSync();
    mockAws.config.basePath = dir.name;
    aws.S3 = mockAws.S3;
  });

  after(function () {
    aws.S3 = s3;
    dir.removeCallback();
  });
}

/**
 * Replace `upload` with a function that uses the local file system
 *
 * @param {string} directory The directory in which to create buckets
 * @returns {void}
 */
function hookUpload(directory) {
  before(function () {
    sinon.stub(S3ObjectStore.prototype, 'upload')
      .callsFake((params) => {
        const { Body: body, Bucket: bucket, Key: key } = params;
        const bucketPath = path.join(directory, bucket);
        if (!fs.existsSync(bucketPath)) {
          fs.mkdirSync(bucketPath, { recursive: true });
        }
        const filePath = path.join(bucketPath, key);
        const writeStream = fs.createWriteStream(filePath);
        body.pipe(writeStream);
        return {
          on: (_event, cb) => {
            writeStream.on('finish', () => {
              const fileSize = fs.statSync(filePath).size;
              cb({ total: fileSize });
            });
          },
          send: (cb) => { cb(null, {}); },
        };
      });
  });

  after(function () {
    S3ObjectStore.prototype.upload.restore();
  });
}

/**
 * Replace `getObject` with a function that uses the local file system
 *
 * @param {string} directory The directory in which the buckets are kept
 * @returns {void}
 */
function hookGetObject(directory) {
  before(function () {
    sinon.stub(S3ObjectStore.prototype, 'getObject')
      .callsFake((params) => {
        const { Bucket: bucket, Key: key } = params;
        const filePath = path.join(directory, bucket, key);
        const data = fs.readFileSync(filePath);

        return {
          promise: () => new Promise((resolve, _reject) => resolve(data)),
        };
      });
  });

  after(function () {
    S3ObjectStore.prototype.getObject.restore();
  });
}

/**
 * Replace `deleteObject` with a function that uses the local file system
 *
 * @param {string} directory The directory in which the buckets are kept
 * @returns {void}
 */
function hookDeleteObject(directory) {
  before(function () {
    sinon.stub(S3ObjectStore.prototype, 'deleteObject')
      .callsFake((params) => {
        const { Bucket: bucket, Key: key } = params;
        const filePath = path.join(directory, bucket, key);
        const data = fs.readFileSync(filePath);

        return {
          promise: () => new Promise((resolve, _reject) => resolve(data)),
        };
      });
  });

  after(function () {
    S3ObjectStore.prototype.deleteObject.restore();
  });
}


/**
 * Adds stubs to S3 object signing that retain the username from the 'A-userid' parameter.
 *
 * @returns {string} The URL prefix for use in matching responses
 */
function hookSignS3Object() {
  const prefix = 'https://example.com/s3/signed/';
  before(function () {
    sinon.stub(S3ObjectStore.prototype, 'signGetObject')
      .callsFake((url, params) => `${prefix}${params['A-userid']}`);
  });
  after(function () {
    S3ObjectStore.prototype.signGetObject.restore();
  });
  return prefix;
}

module.exports = {
  hookMockS3,
  hookSignS3Object,
  hookUpload,
  hookGetObject,
  hookDeleteObject,
};
