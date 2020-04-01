const { expect } = require('chai');
const sinon = require('sinon');
const { describe, it, before, after } = require('mocha');
const { hookServersStartStop } = require('./helpers/servers');
const { createPublicPermalink } = require('../app/frontends/service-results');
const { S3ObjectStore } = require('../app/util/object-store');
const { hookUrl } = require('./helpers/hooks');

describe('service-results', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('createPublicPermalink', function () {
    it('returns Harmony permalink when given an S3 link prefixed with /public/', function () {
      const result = createPublicPermalink('s3://some-bucket/public/some/key.txt', 'https://example.com');
      expect(result).to.equal('https://example.com/service-results/some-bucket/public/some/key.txt');
    });

    it('throws an error when given an S3 link not prefixed with /public/', function () {
      const result = () => createPublicPermalink('s3://some-bucket/private/some/key.txt', 'https://example.com');
      expect(result).to.throw(TypeError);
    });

    it('returns S3 links unaltered when the mime type is application/x-zarr', function () {
      const result = createPublicPermalink('s3://some-bucket/some/key.txt', 'https://example.com', 'application/x-zarr');
      expect(result).to.equal('s3://some-bucket/some/key.txt');
    });

    /**
     * Adds an `it` statement asserting createPublicPermalink does not alter links with
     * the given protocol
     *
     * @param {string} protocol the protocol to assert
     * @returns {void}
     */
    function itDoesNotAlter(protocol) {
      it(`returns ${protocol} links unaltered`, function () {
        const result = createPublicPermalink(`${protocol}://some/resource.txt`, 'https://example.com');
        expect(result).to.equal(`${protocol}://some/resource.txt`);
      });
    }
    itDoesNotAlter('ftp');
    itDoesNotAlter('sftp');
    itDoesNotAlter('http');
    itDoesNotAlter('https');

    it('throws an error when presented with an unrecognized link', function () {
      const result = () => createPublicPermalink('gopher://some/resource.txt', 'https://example.com');
      expect(result).to.throw(TypeError);
    });
  });

  describe('When a request provides no token', function () {
    hookUrl('/service-results/some-bucket/public/some/path.tif');

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });
  });

  describe('getServiceResult', function () {
    describe('when given a valid bucket and key', function () {
      let stub;
      before(function () {
        stub = sinon.stub(S3ObjectStore.prototype, 'signGetObject')
          .callsFake((url, params) => `https://example.com/signed/${params['A-userid']}`);
      });
      hookUrl('/service-results/some-bucket/public/some/path.tif', 'jdoe');
      after(function () {
        stub.restore();
      });

      it('signs the S3 URL indicated by the path', function () {
        expect(stub.getCall(0).args[0]).to.equal('s3://some-bucket/public/some/path.tif');
      });

      it("passes the user's Earthdata Login username to the signing function for tracking", function () {
        expect(stub.getCall(0).args[1]).to.eql({ 'A-userid': 'jdoe' });
      });

      it('redirects temporarily to a presigned URL', function () {
        expect(this.res.statusCode).to.equal(307);
        expect(this.res.headers.location).to.equal('https://example.com/signed/jdoe');
      });

      it('sets a cache-control header to indicate the redirect should be reused', function () {
        expect(this.res.headers['cache-control']).to.equal('private, max-age=600');
      });
    });

    describe('when given a valid bucket and key that cannot be signed', function () {
      let stub;
      before(function () {
        stub = sinon.stub(S3ObjectStore.prototype, 'signGetObject').throws();
      });
      hookUrl('/service-results/some-bucket/public/some/path.tif', 'jdoe');
      after(function () {
        stub.restore();
      });


      it('returns a 404 response', function () {
        expect(this.res.statusCode).to.equal(404);
      });
    });
  });
});
