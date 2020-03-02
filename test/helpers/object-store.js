const { before, after } = require('mocha');
const sinon = require('sinon');
const { S3ObjectStore } = require('../../app/util/object-store');

/**
 * Adds stubs to S3 object signing that retain the username form the 'A-userid' parameter.
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
  hookSignS3Object,
};
