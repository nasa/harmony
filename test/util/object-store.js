const { describe, it } = require('mocha');
const { expect } = require('chai');
const { objectStoreForProtocol, S3ObjectStore } = require('../../app/util/object-store');

describe('util/object-store', function () {
  describe('objectStoreForProtocol', function () {
    it('returns null when no protocol is supplied', function () {
      expect(objectStoreForProtocol()).to.be.null;
    });

    it('returns null when an unrecognized protocol is supplied', function () {
      expect(objectStoreForProtocol('azure')).to.be.null;
    });

    it('returns an S3ObjectStore when "s3" is supplied as the protocol', function () {
      expect(objectStoreForProtocol('s3')).to.be.instanceof(S3ObjectStore);
    });

    it('is case insensitive', function () {
      expect(objectStoreForProtocol('S3')).to.be.instanceof(S3ObjectStore);
    });

    it('ignores trailing colons on the protocol', function () {
      expect(objectStoreForProtocol('s3:')).to.be.instanceof(S3ObjectStore);
    });
  });
});
