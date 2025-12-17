import { expect } from 'chai';
import { describe, it } from 'mocha';
import sinon, { stub } from 'sinon';

import { createPublicPermalink, providerAndCollectionIdCache } from '../app/frontends/service-results';
import { FileStore } from '../app/util/object-store/file-store';
import { hookUrl } from './helpers/hooks';
import hookServersStartStop from './helpers/servers';

describe('service-results', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  describe('createPublicPermalink', function () {
    it('returns Harmony permalink when given an S3 link prefixed with /public/', function () {
      const result = createPublicPermalink('s3://some-bucket/public/some/key.txt', 'https://example.com');
      expect(result).to.equal('https://example.com/service-results/some-bucket/public/some/key.txt');
    });

    it('throws an error when given an S3 link not prefixed with /public/', function () {
      const result = (): string => createPublicPermalink('s3://some-bucket/private/some/key.txt', 'https://example.com');
      expect(result).to.throw(TypeError);
    });

    it('returns S3 links unaltered when the mime type is application/x-zarr', function () {
      const result = createPublicPermalink('s3://some-bucket/some/key.txt', 'https://example.com', 'application/x-zarr');
      expect(result).to.equal('s3://some-bucket/some/key.txt');
    });

    it('returns S3 links unaltered when the linkType is s3', function () {
      const result = createPublicPermalink('s3://some-bucket/some/key.json', 'https://example.com', 'application/json', 's3');
      expect(result).to.equal('s3://some-bucket/some/key.json');
    });

    /**
     * Adds an `it` statement asserting createPublicPermalink does not alter links with
     * the given protocol
     *
     * @param protocol - the protocol to assert
     */
    function itDoesNotAlter(protocol: string): void {
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
      const result = (): string => createPublicPermalink('gopher://some/resource.txt', 'https://example.com');
      expect(result).to.throw(TypeError);
    });
  });

  describe('When a request provides no token', function () {
    hookUrl('/service-results/some-bucket/public/some/path.tif', null);

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });
  });

  describe('getServiceResult', function () {
    describe('when given a URL containing an output created by harmony with a job ID and work item ID in the URL', function () {
      let providerCollectionIdCacheStub;

      before(function () {
        providerCollectionIdCacheStub = sinon.stub(providerAndCollectionIdCache, 'fetch').resolves(
          { providerId: 'eedtest', collectionIds: 'collection1,collection2' },
        );
      });

      after(function () {
        providerCollectionIdCacheStub.restore();
      });

      hookUrl('/service-results/some-bucket/public/some-job-id/some-work-item-id/some-path.tif', 'jdoe');
      it('passes the user\'s Earthdata Login username to the signing function for tracking', function () {
        expect(this.res.headers.location).to.include('A-userid=jdoe');
        expect(this.res.headers.location).to.include('A-provider=EEDTEST');
        expect(this.res.headers.location).to.include('A-collection-concept-ids=COLLECTION1%2CCOLLECTION2');
      });

      it('redirects temporarily to a presigned URL', function () {
        expect(this.res.statusCode).to.equal(307);
        expect(this.res.headers.location).to.include('some-bucket/public/some-job-id/some-work-item-id/some-path.tif');
      });

      it('includes an api_request_id field', function () {
        expect(this.res.headers.location).to.include('A-api-request-uuid=some-job-id');
      });

      it('includes a provider field', function () {
        expect(this.res.headers.location).to.include('A-provider=EEDTEST');
      });

      it('sets a cache-control header to indicate the redirect should be reused', function () {
        expect(this.res.headers['cache-control']).to.equal('private, max-age=600');
      });
    });

    describe('when given a valid bucket and key that cannot be signed', function () {
      let stubObject;
      before(function () {
        stubObject = stub(FileStore.prototype, 'signGetObject').throws();
      });
      hookUrl('/service-results/some-bucket/public/some-job-id/some-work-item-id/some-path.tif', 'jdoe');
      after(function () {
        stubObject.restore();
      });

      it('returns a 404 response', function () {
        expect(this.res.statusCode).to.equal(404);
      });
    });
  });

  describe('when given a service-results URL to test data staged in a harmony UAT bucket', function () {
    hookUrl('/service-results/harmony-uat-eedtest-data/C1233800302-EEDTEST/nc/001_01_7f00ff_africa.nc', 'jdoe');

    it('redirects temporarily to a presigned URL', function () {
      expect(this.res.statusCode).to.equal(307);
      expect(this.res.headers.location).to.include('harmony-uat-eedtest-data/C1233800302-EEDTEST/nc/001_01_7f00ff_africa.nc');
    });

    it('passes the user\'s Earthdata Login username to the signing function for tracking', function () {
      expect(this.res.headers.location).to.include('A-userid=jdoe');
    });

    it('does not include an api_request_id field', function () {
      expect(this.res.headers.location).to.not.include('A-api-request-uuid');
    });

    it('does not include a provider field', function () {
      expect(this.res.headers.location).to.not.include('A-provider');
    });

    it('sets a cache-control header to indicate the redirect should be reused', function () {
      expect(this.res.headers['cache-control']).to.equal('private, max-age=600');
    });
  });
});
