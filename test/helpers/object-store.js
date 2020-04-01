const { before, after } = require('mocha');
const sinon = require('sinon');
const aws = require('aws-sdk');
const mockAws = require('mock-aws-s3');
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
};
