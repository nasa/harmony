import { expect } from 'chai';
import { Response } from 'express';
import { describe, it } from 'mocha';
import sinon from 'sinon';
import request from 'supertest';

import * as docs from '../app/frontends/docs/docs';
import HarmonyRequest from '../app/models/harmony-request';
import env from '../app/util/env';
import version from '../app/util/version';
import { hookDocumentationPage } from './helpers/documentation-page';
import { hookRequest } from './helpers/hooks';
import hookServersStartStop from './helpers/servers';

const TEST_PREVIEW_THRESHOLD = 1234;

describe('Documentation generation and caching', function () {
  let generateDocumentationSpy: sinon.SinonSpy;
  let clearCacheSpy: sinon.SinonSpy;
  let mockResponse: Partial<Response>;

  before(function () {
    // Create spy on the generateDocumentation function
    generateDocumentationSpy = sinon.spy(docs, 'generateDocumentation');
    // Create spy on the clearCache function
    clearCacheSpy = sinon.spy(docs, 'clearCache');

    // Create mock response object
    mockResponse = {
      render: sinon.stub(),
    };
  });

  after(function () {
    clearCacheSpy.restore();
    generateDocumentationSpy.restore();
    // clear the docs cache so later tests work
    docs.clearCache();
  });

  describe('when called with a cloudfront URL', function () {
    it('should generate documentation and clear the cache', async function () {
      const req: HarmonyRequest = {
        get: (_arg) => 'dqzb5lcolc8fj.cloudfront.net',
      } as HarmonyRequest;

      await docs.default(req, mockResponse as Response);
      expect(generateDocumentationSpy.called).to.be.true;
      expect(generateDocumentationSpy.calledOnce).to.be.true;
      expect(generateDocumentationSpy.calledWith('https://dqzb5lcolc8fj.cloudfront.net')).to.be.true;
      expect(clearCacheSpy.calledOnce).to.be.true;
    });
  });

  describe('when called again with the production URL', function () {
    it('should generate documentation and not clear the cache again', async function () {
      const req: HarmonyRequest = {
        get: (_arg) => 'harmony.earthdata.nasa.gov',
      } as HarmonyRequest;

      await docs.default(req, mockResponse as Response);

      expect(generateDocumentationSpy.callCount).to.eql(2);
      expect(generateDocumentationSpy.calledWith('https://harmony.earthdata.nasa.gov')).to.be.true;
      expect(clearCacheSpy.calledOnce).to.be.true;
    });

    it('should use cached documentation on subsequent calls', async function () {
      const req: HarmonyRequest = {
        get: (_arg) => 'harmony.earthdata.nasa.gov',
      } as HarmonyRequest;

      // First call
      await docs.default(req, mockResponse as Response);

      // Second call
      await docs.default(req, mockResponse as Response);

      // generateDocumentation should not be called again due to caching
      expect(generateDocumentationSpy.callCount).to.eql(2);
    });
  });
});


describe('Documentation page', function () {
  hookServersStartStop();

  let currentPreviewThreshold;
  before(function () {
    currentPreviewThreshold = env.previewThreshold;
    env.previewThreshold = TEST_PREVIEW_THRESHOLD;
  });
  after(function () {
    env.previewThreshold = currentPreviewThreshold;
  });

  describe('when hitting the Harmony documentation page URL', function () {
    hookDocumentationPage();

    it('returns a 200 success', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns an HTML response', function () {
      expect(this.res.get('Content-Type')).to.equal('text/html; charset=utf-8');
      expect(this.res.text).to.include('<title>Harmony Documentation</title>');
    });

    it('links to the versions endpoint', function () {
      expect(this.res.text).to.match(/<a[^>]* href="\/versions"[^>]*>versions<\/a>/);
    });

    it('provides a table of contents', function () {
      expect(this.res.text).to.include('<nav class="table-of-contents">');
    });

    it('provides a link to the current EDL environment', function () {
      expect(this.res.text).to.include(`<a href="${env.oauthHost}">Earthdata Login</a>`);
    });

    it('links to a Swagger UI for the coverages API', function () {
      expect(this.res.text).to.match(/<a[^>]* href="\/docs\/api"[^>]*>OGC Coverages API<\/a>/);
    });

    it('links to a Swagger UI for the EDR API', function () {
      expect(this.res.text).to.match(/<a[^>]* href="\/docs\/edr-api"[^>]*>OGC EDR API<\/a>/);
    });

    it('displays the current Harmony version', function () {
      expect(this.res.text).to.include(`v ${version}`);
    });

    it('provides an absolute URL template for the OGC API Coverages endpoint', function () {
      expect(this.res.text).to.match(/http[s]*:\/\/[^/]+\/{collectionId}\/ogc-api-coverages\/1\.0\.0/);
    });

    it('provides an absolute URL template for the OGC API EDR endpoint', function () {
      expect(this.res.text).to.match(/http[s]*:\/\/[^/]+\/ogc-api-edr\/1\.1\.0\/collections\/{collectionId}\/cube/);
    });

    it('provides an absolute URL template for the WMS endpoint', function () {
      expect(this.res.text).to.match(/http[s]*:\/\/[^/]+\/{collectionId}\/wms/);
    });

    it('provides an overview section', function () {
      expect(this.res.text).to.include('<h2 id="overview"');
    });

    it('provides an getting started section', function () {
      expect(this.res.text).to.include('<h2 id="getting-started"');
    });

    it('provides a summary of available endpoints', function () {
      expect(this.res.text).to.include('<h2 id="summary-of-available-endpoints"');
    });

    it('provides a section on the service APIs', function () {
      expect(this.res.text).to.include('<h2 id="using-the-service-apis"');
    });

    it('provides a list of available services', function () {
      expect(this.res.text).to.include('<h2 id="available-services"');
    });

    it('provides a section on the capabilities endpoints', function () {
      expect(this.res.text).to.include('<h3 id="get-harmony-capabilities-for-the-provided-collection"');
    });

    it('provides a section on the jobs API and the workflow-UI', function () {
      expect(this.res.text).to.include('<h3 id="monitoring-jobs-with-the-jobs-api-and-the-workflow-ui"');
    });

    it('includes a statement documenting the preview threshold', function () {
      expect(this.res.text).to.include(`<p><strong>Note:</strong> The current threshold in this environment for the number of granules that will trigger automatic pausing of a job is <strong>${TEST_PREVIEW_THRESHOLD}</strong>.</p>`);
    });

    it('provides a section on the stac endpoints', function () {
      expect(this.res.text).to.include('<h3 id="retrieving-stac-catalog-and-catalog-items-for-processed-data"');
    });

    it('provides a section on user-owned S3 buckets', function () {
      expect(this.res.text).to.include('<h2 id="user-owned-buckets-for-harmony-output"');
    });

    describe('opening the API documentation link', function () {
      // URL's existence verified above
      hookRequest((app) => request(app).get('/docs/api/'));

      it('provides a swagger UI representation of the Harmony API', function () {
        expect(this.res.statusCode).to.equal(200);
        expect(this.res.text).to.include('Swagger UI');
      });
    });
  });
});
