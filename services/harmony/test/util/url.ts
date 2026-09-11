import { expect } from 'chai';
import { describe, it } from 'mocha';

import { getRequestUrl, getSanitizedRequestUrl, getRequestRoot, isValidUri } from '../../app/util/url';

/**
 * Returns a request object to be used in tests to simulate different URLs
 *
 * @param hostname - The hostname for the mock request
 * @param path - the URL path
 * @param params - the query parameters
 * @returns An object emulating an http.IncomingMessage
 */
function createRequest(
  hostname: string,
  path = '/example/path',
  params: object = { param1: 'foo', param2: 2 },
  extraHeaders: Record<string, string> = {},
): object {
  const headers = {
    host: hostname,
    ...extraHeaders,
  };
  return {
    originalUrl: `${path}?${params}`,
    query: params,
    get(headerName: string): string { return headers[headerName.toLowerCase()]; },
  };
}

describe('util/url', function () {
  describe('#getRequestUrl', function () {
    describe('using localhost', function () {
      const request = createRequest('localhost:5555');
      it('returns the correct URL starting with http', function () {
        expect(getRequestUrl(request, true)).to.equal('http://localhost:5555/example/path?param1=foo&param2=2');
      });
    });

    describe('using 127.0.0.1', function () {
      const request = createRequest('127.0.0.1:5555');
      it('returns the correct URL starting with http', function () {
        expect(getRequestUrl(request)).to.equal('http://127.0.0.1:5555/example/path?param1=foo&param2=2');
      });
    });

    describe('using harmony.earthdata.nasa.gov', function () {
      const request = createRequest('harmony.earthdata.nasa.gov');
      it('returns the correct URL starting with https', function () {
        expect(getRequestUrl(request)).to.equal('https://harmony.earthdata.nasa.gov/example/path?param1=foo&param2=2');
      });
    });

    describe('using forwarded proto/host/port', function () {
      const request = createRequest('localhost', '/example/path', { param1: 'foo', param2: 2 }, {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'localhost',
        'x-forwarded-port': '8443',
      });
      it('returns the forwarded external URL', function () {
        expect(getRequestUrl(request)).to.equal('https://localhost:8443/example/path?param1=foo&param2=2');
      });
    });

    describe('when forwarded headers contain multiple values', function () {
      const request = createRequest('localhost:8080', '/example/path', { param1: 'foo', param2: 2 }, {
        'x-forwarded-proto': 'https,http',
        'x-forwarded-host': 'localhost,internal-host:8080',
        'x-forwarded-port': '8443,8080',
      });
      it('uses the first forwarded value', function () {
        expect(getRequestUrl(request)).to.equal('https://localhost:8443/example/path?param1=foo&param2=2');
      });
    });

    describe('when forwarded proto is invalid', function () {
      const request = createRequest('harmony.earthdata.nasa.gov', '/example/path', { param1: 'foo', param2: 2 }, {
        'x-forwarded-proto': 'bogus-proto',
      });
      it('falls back to inferred protocol', function () {
        expect(getRequestUrl(request)).to.equal('https://harmony.earthdata.nasa.gov/example/path?param1=foo&param2=2');
      });
    });

    describe('when direct host has port but forwarded host does not', function () {
      const request = createRequest('localhost:8443', '/example/path', { param1: 'foo', param2: 2 }, {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'localhost',
      });
      it('keeps the direct host port', function () {
        expect(getRequestUrl(request)).to.equal('https://localhost:8443/example/path?param1=foo&param2=2');
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
      const request = createRequest('localhost:5555', '/example/path');
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:5555/example/path?param1=foo&param2=2');
      });
    });

    describe('with query parameters and one trailing slash', function () {
      const request = createRequest('localhost:5555', '/example/path/');
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:5555/example/path?param1=foo&param2=2');
      });
    });

    describe('with query parameters and many slashes', function () {
      const request = createRequest('localhost:5555', '/example/path//////');
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:5555/example/path?param1=foo&param2=2');
      });
    });

    describe('without query parameters and no trailing slash', function () {
      const request = createRequest('localhost:5555', '/example/path', {});
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:5555/example/path');
      });
    });

    describe('without query parameters and one trailing slash', function () {
      const request = createRequest('localhost:5555', '/example/path/', {});
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:5555/example/path');
      });
    });

    describe('without query parameters and many slashes', function () {
      const request = createRequest('localhost:5555', '/example/path///////', {});
      it('returns the correct URL starting with http', function () {
        expect(getSanitizedRequestUrl(request, true)).to.equal('http://localhost:5555/example/path');
      });
    });
  });

  describe('#getRequestRoot', function () {
    describe('using localhost', function () {
      const request = createRequest('localhost:5555');
      it('returns the correct root starting with http', function () {
        expect(getRequestRoot(request)).to.equal('http://localhost:5555');
      });
    });

    describe('using 127.0.0.1', function () {
      const request = createRequest('127.0.0.1:5555');
      it('returns the correct root starting with http', function () {
        expect(getRequestRoot(request)).to.equal('http://127.0.0.1:5555');
      });
    });

    describe('using forwarded proto/host/port', function () {
      const request = createRequest('localhost', '/example/path', { param1: 'foo', param2: 2 }, {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'localhost',
        'x-forwarded-port': '8443',
      });
      it('returns the forwarded external root', function () {
        expect(getRequestRoot(request)).to.equal('https://localhost:8443');
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

describe('isValidUri', function () {
  it('should return true for a valid http URI', function () {
    expect(isValidUri('http://example.com')).to.be.true;
  });

  it('should return true for a valid https URI', function () {
    expect(isValidUri('https://example.com')).to.be.true;
  });

  it('should return true for a valid s3 URI', function () {
    expect(isValidUri('s3://bucket-name/key')).to.be.true;
  });

  it('should return true for a valid file URI', function () {
    expect(isValidUri('file:///tmp/shapefile.txt')).to.be.true;
    expect(isValidUri('file:///C:/path/to/file.txt')).to.be.true;
  });

  it('should return false for an invalid URI', function () {
    expect(isValidUri('invalid-uri')).to.be.false;
    expect(isValidUri('http://')).to.be.false;
    expect(isValidUri('')).to.be.false;
  });
});

