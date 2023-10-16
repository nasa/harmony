import { expect } from 'chai';
import { describe, it } from 'mocha';
import request from 'supertest';
import hookServersStartStop from './helpers/servers';
import { hookRequest } from './helpers/hooks';
import env from '../app/util/env';
import version from '../app/util/version';
import { hookDocumentationPage } from './helpers/documentation-page';

describe('Documentation page', function () {
  hookServersStartStop();

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
      expect(this.res.text).to.match(/<a[^>]* href="\/docs\/api"[^>]*>API Documentation<\/a>/);
    });

    it('displays the current Harmony version', function () {
      expect(this.res.text).to.include(`v ${version}`);
    });

    it('provides an absolute URL template for the OGC API Coverages endpoint', function () {
      expect(this.res.text).to.match(/http[s]*:\/\/[^/]+\/{collectionId}\/ogc-api-coverages\/1\.0\.0/);
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

    it('provides a section on the jobs API and the workflow-UI', function () {
      expect(this.res.text).to.include('<h3 id="monitoring-jobs-with-the-jobs-api-and-the-workflow-ui"');
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
