import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookServersStartStop from './helpers/servers';
import { hookLandingPage } from './helpers/landing-page';
import { env } from 'harmony-util';
import version from '../app/util/version';

// This is the bulk of our HTML content.  If we do anything significant with HTML, we should
// use a more capable testing framework like nightwatch.

describe('Landing page', function () {
  hookServersStartStop();

  describe('when hitting the root Harmony URL', function () {
    hookLandingPage();

    it('returns a 200 success', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns an HTML response', function () {
      expect(this.res.get('Content-Type')).to.equal('text/html; charset=utf-8');
    });

    it('provides a link to the current EDL environment', function () {
      expect(this.res.text).to.include(`<a href="${env.oauthHost}">Earthdata Login</a>`);
    });

    it('links to the documentation', function () {
      expect(this.res.text).to.match(/<a[^>]* href="\/docs"[^>]*>Documentation<\/a>/);
    });

    it('displays the current Harmony version', function () {
      expect(this.res.text).to.include(`v ${version}`);
    });

    it('provides an absolute URL template for the OGC API Coverages endpoint', function () {
      expect(this.res.text).to.match(/http:&#x2F;&#x2F;[^/]+\/{collectionId}\/ogc-api-coverages\/1\.0\.0/);
    });

    it('provides an absolute URL template for the WMS endpoint', function () {
      expect(this.res.text).to.match(/http:&#x2F;&#x2F;[^/]+\/{collectionId}\/wms/);
    });
  });
});
