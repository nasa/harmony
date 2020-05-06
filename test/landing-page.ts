import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookServersStartStop from './helpers/servers';
import { hookLandingPage } from './helpers/landing-page';

describe('Landing page', function () {
  hookServersStartStop();

  describe('when hitting the root Harmony URL', function () {
    hookLandingPage();

    it('returns a 200 success', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns a JSON response', function () {
      expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
    });

    it('returns a description mentioning the OGC coverages api', function () {
      const { description } = JSON.parse(this.res.text);
      expect(description).to.include('/{collectionId}/ogc-api-coverages/1.0.0');
    });

    it('returns a link to itself', function () {
      const { links } = JSON.parse(this.res.text);
      expect(links[0].title).to.equal('Harmony landing page');
      expect(links[0].href).to.match(/^http.*/);
      expect(links[0].rel).to.equal('self');
      expect(links[0].type).to.equal('application/json');
    });

    it('returns a link to the jobs route', function () {
      const { links } = JSON.parse(this.res.text);
      expect(links[1].title).to.equal('Jobs listing returning all jobs for the logged in user');
      expect(links[1].href).to.match(/^http.*\/jobs$/);
      expect(links[1].rel).to.equal('jobs');
      expect(links[1].type).to.equal('application/json');
    });

    it('returns a link to the cloud access JSON route', function () {
      const { links } = JSON.parse(this.res.text);
      expect(links[2].title).to.include('Access keys for s3:// URLs, usable from AWS ');
      expect(links[2].title).to.include('(JSON format)');
      expect(links[2].href).to.match(/^http.*\/cloud-access$/);
      expect(links[2].rel).to.equal('cloud-access-json');
      expect(links[2].type).to.equal('application/json');
    });

    it('returns a link to the cloud access shell script route', function () {
      const { links } = JSON.parse(this.res.text);
      expect(links[3].title).to.include('Access keys for s3:// URLs, usable from AWS ');
      expect(links[3].title).to.include('(Shell format)');
      expect(links[3].href).to.match(/^http.*\/cloud-access.sh$/);
      expect(links[3].rel).to.equal('cloud-access-sh');
      expect(links[3].type).to.equal('application/x-sh');
    });
  });
});
