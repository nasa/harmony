const { describe, it } = require('mocha');
const { expect } = require('chai');
const { getRequestUrl, getSanitizedRequestUrl, getRequestRoot } = require('../../app/util/url');

/**
 * Returns a request object to be used in tests to simulate different URLs
 *
 * @param {String} hostname The hostname for the mock request
 * @param {String} path the URL path
 * @param {Object} params the query parameters
 * @returns {Object} An object emulating an http.IncomingMessage
 */
function createRequest(hostname, path = '/example/path', params = { param1: 'foo', param2: 2 }) {
  return {
    originalUrl: `${path}?${params}`,
    query: params,
    get() { return hostname; },
  };
}

describe('util/url', function () {
  describe('#getRequestUrl', function () {
    describe('using localhost', function () {
      const request = createRequest('localhost:3000');
      it('returns the correct URL starting with http', function () {
        expect(getRequestUrl(request, true)).to.equal('http://localhost:3000/example/path?param1=foo&param2=2');
      });
    });

    describe('using 127.0.0.1', function () {
      const request = createRequest('127.0.0.1:3000');
      it('returns the correct URL starting with http', function () {
        expect(getRequestUrl(request)).to.equal('http://127.0.0.1:3000/example/path?param1=foo&param2=2');
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

  describe('#getSanitizedRequestUrl', function () {
    describe('with query parameters and no trailing slash', function () {
      const request = createRequest('localhost:3000', '/example/path');
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:3000/example/path?param1=foo&param2=2');
      });
    });

    describe('with query parameters and one trailing slash', function () {
      const request = createRequest('localhost:3000', '/example/path/');
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:3000/example/path?param1=foo&param2=2');
      });
    });

    describe('with query parameters and many slashes', function () {
      const request = createRequest('localhost:3000', '/example/path//////');
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:3000/example/path?param1=foo&param2=2');
      });
    });

    describe('without query parameters and no trailing slash', function () {
      const request = createRequest('localhost:3000', '/example/path', {});
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:3000/example/path');
      });
    });

    describe('without query parameters and one trailing slash', function () {
      const request = createRequest('localhost:3000', '/example/path/', {});
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:3000/example/path');
      });
    });

    describe('without query parameters and many slashes', function () {
      const request = createRequest('localhost:3000', '/example/path///////', {});
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:3000/example/path');
      });
    });
  });

  describe('#getRequestRoot', function () {
    describe('using localhost', function () {
      const request = createRequest('localhost:3000');
      it('returns the correct root starting with http', function () {
        expect(getRequestRoot(request)).to.equal('http://localhost:3000');
      });
    });

    describe('using 127.0.0.1', function () {
      const request = createRequest('127.0.0.1:3000');
      it('returns the correct root starting with http', function () {
        expect(getRequestRoot(request)).to.equal('http://127.0.0.1:3000');
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
