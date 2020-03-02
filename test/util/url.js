const { describe, it } = require('mocha');
const { expect } = require('chai');
const { getRequestUrl, getRequestRoot } = require('../../app/util/url');

/**
 * Returns a request object to be used in tests to simulate different URLs
 *
 * @param {String} hostname The hostname for the mock request
 * @returns {Object} An object emulating an http.IncomingMessage
 */
function createRequest(hostname) {
  return {
    originalUrl: '/example/path?param1=foo&param2=bar',
    query: { param1: 'foo', param2: 2 },
    get() { return hostname; },
  };
}

describe('util/url', function () {
  describe('#getRequestUrl', function () {
    describe('using localhost', function () {
      const request = createRequest('localhost');
      it('returns the correct URL starting with http', function () {
        expect(getRequestUrl(request, true)).to.equal('http://localhost/example/path?param1=foo&param2=2');
      });
    });

    describe('using 127.0.0.1', function () {
      const request = createRequest('127.0.0.1');
      it('returns the correct URL starting with http', function () {
        expect(getRequestUrl(request)).to.equal('http://127.0.0.1/example/path?param1=foo&param2=2');
      });
    });

    describe('using harmony.earthdata.nasa.gov', function () {
      const request = createRequest('harmony.earthdata.nasa.gov');
      it('returns the correct URL starting with https', function () {
        expect(getRequestUrl(request)).to.equal('https://harmony.earthdata.nasa.gov/example/path?param1=foo&param2=2');
      });
    });

    describe('specifying includeQuery=true', function () {
      const request = createRequest('harmony.earthdata.nasa.gov');
      it('includes the query parameter string', function () {
        expect(getRequestUrl(request, true)).to.equal('https://harmony.earthdata.nasa.gov/example/path?param1=foo&param2=2');
      });
    });

    describe('specifying includeQuery=false', function () {
      const request = createRequest('harmony.earthdata.nasa.gov');
      it('does NOT include the query parameter string', function () {
        expect(getRequestUrl(request, false)).to.equal('https://harmony.earthdata.nasa.gov/example/path');
      });
    });
  });

  describe('#getRequestRoot', function () {
    describe('using localhost', function () {
      const request = createRequest('localhost');
      it('returns the correct root starting with http', function () {
        expect(getRequestRoot(request)).to.equal('http://localhost');
      });
    });

    describe('using 127.0.0.1', function () {
      const request = createRequest('127.0.0.1');
      it('returns the correct root starting with http', function () {
        expect(getRequestRoot(request)).to.equal('http://127.0.0.1');
      });
    });
  });

  describe('using harmony.earthdata.nasa.gov', function () {
    const request = createRequest('harmony.earthdata.nasa.gov');
    it('returns the correct root starting with https', function () {
      expect(getRequestRoot(request)).to.equal('https://harmony.earthdata.nasa.gov');
    });
  });
});
