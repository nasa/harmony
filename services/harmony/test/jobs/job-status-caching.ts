import { expect } from 'chai';
import sinon from 'sinon';

import { Job } from '../../app/models/job';
import { jobStatusCache } from '../../app/util/job';
import { hookRedirect } from '../helpers/hooks';
import { itIncludesADataExpirationField } from '../helpers/job-status';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';

const collection = 'C1260128044-EEDTEST';
const query = {
  maxResults: 1,
  subset: 'lat(60:65)',
  format: 'application/x-netcdf4',
  forceAsync: true,
  label: ['000', 'bar', 'foo', 'z-label'],
};

describe('jobStatusCaching', function () {
  // We disable job status caching for all other tests, so we need to first
  // restore to the real caching behavior
  before(() => {
    if ((jobStatusCache.get as sinon.SinonStub).restore) {
      (jobStatusCache.get as sinon.SinonStub).restore();
    }
  });

  after(() => {
    sinon.stub(jobStatusCache, 'get').returns(undefined);
  });

  hookServersStartStop();
  let jobId;
  let redirect;

  describe('when making an async request', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query } );
    it('caches the job status page', function () {
      redirect = this.res.headers.location;
      jobId = redirect.split('/')[2];
      expect(jobStatusCache.get(jobId)).to.not.be.undefined;
    });

    describe('when following the redirect', function () {
      hookRedirect('joe');
      it('uses the cached result to return the job status page', function () {
        const job = new Job(JSON.parse(this.res.text));
        const selves = job.getRelatedLinks('self');
        expect(selves.length).to.equal(1);
        // Note the way we can tell it is cached is the title of the link is 'Job Status'. When
        // we get the job status from the database it instead has a title of 'The current page'
        // due to the way we set pagination links
        expect(selves[0].title).to.equal('Job Status');
      });

      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('includes a "self" relation on the returned job', function () {
        const job = new Job(JSON.parse(this.res.text));
        const selves = job.getRelatedLinks('self');
        expect(selves.length).to.equal(1);
        expect(selves[0].href).to.match(new RegExp(`.*?${this.res.req.path}`));
      });

      it('includes links for canceling and pausing the job', function () {
        const job = new Job(JSON.parse(this.res.text));
        const pauseLinks = job.getRelatedLinks('pauser');
        expect(pauseLinks.length).to.equal(1);
        const cancelLinks = job.getRelatedLinks('canceler');
        expect(cancelLinks.length).to.equal(1);
      });

      it('does not include irrelevant state change links', function () {
        const job = new Job(JSON.parse(this.res.text));
        const resumeLinks = job.getRelatedLinks('resumer');
        expect(resumeLinks.length).to.equal(0);
        const previewSkipLinks = job.getRelatedLinks('preview-skipper');
        expect(previewSkipLinks.length).to.equal(0);
      });

      it('includes sorted job labels', function () {
        const job = new Job(JSON.parse(this.res.text));
        expect(job.labels).deep.equal(['000', 'bar', 'foo', 'z-label']);
      });

      it('does not include data size reduction information', function () {
        const job = JSON.parse(this.res.text);
        expect(job.originalDataSize).to.be.undefined;
        expect(job.outputDataSize).to.be.undefined;
        expect(job.dataSizePercentChange).to.be.undefined;
      });

      itIncludesADataExpirationField();

      it('removes the job status from the cache', function () {
        expect(jobStatusCache.get(jobId)).to.be.undefined;
      });
    });


    describe('when hitting the job status route for a second time', function () {
      hookRedirect('joe');
      it('does not use the cached job status page', function () {
        const job = new Job(JSON.parse(this.res.text));
        const selves = job.getRelatedLinks('self');
        expect(selves.length).to.equal(1);
        // Note the way we can tell it is cached is the title of the link is 'Job Status'. When
        // we get the job status from the database it instead has a title of 'The current page'
        // due to the way we set pagination links
        expect(selves[0].title).to.equal('The current page');
      });
    });
  });
});