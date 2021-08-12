import { expect } from 'chai';
import { stub } from 'sinon';
import { describe, it, before, after } from 'mocha';
import { v4 as uuid } from 'uuid';
import request from 'supertest';
import { Job } from 'models/job';
import { itReturnsUnchangedDataLinksForZarr, itProvidesAWorkingHttpUrl } from 'test/helpers/job-status';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, hookTransactionFailure } from '../helpers/db';
import { jobStatus, hookJobStatus, jobsEqual, itIncludesRequestUrl, buildJob } from '../helpers/jobs';
import StubService from '../helpers/stub-service';
import { hookRedirect, hookUrl } from '../helpers/hooks';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import env from '../../app/util/env';

const aJob = buildJob({ username: 'joe' });

describe('Individual job status route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  before(async function () {
    await aJob.save(this.trx);
    this.trx.commit();
  });
  const jobID = aJob.requestId;
  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await jobStatus(this.frontend, { jobID }).redirects(0);
    });
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}`));
    });
  });

  describe('For a logged-in user who owns the job', function () {
    hookJobStatus({ jobID, username: 'joe' });
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns a single job record in JSON format', function () {
      const actualJob = new Job(JSON.parse(this.res.text));
      expect(jobsEqual(aJob, actualJob)).to.be.true;
    });

    it('includes a "self" relation on the returned job', function () {
      const job = new Job(JSON.parse(this.res.text));
      const selves = job.getRelatedLinks('self');
      expect(selves.length).to.equal(1);
      expect(selves[0].href).to.match(new RegExp(`.*?${this.res.req.path}\\?page=1&limit=2000$`));
    });
  });

  describe('For a non-existent job ID', function () {
    const unknownRequest = uuid();
    hookJobStatus({ jobID: unknownRequest, username: 'joe' });
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.NotFoundError',
        description: `Error: Unable to find job ${unknownRequest}`,
      });
    });
  });

  describe('For an invalid job ID format', function () {
    hookJobStatus({ jobID: 'not-a-uuid', username: 'joe' });
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Invalid format for Job ID \'not-a-uuid\'. Job ID must be a UUID.',
      });
    });
  });

  describe('When the database catches fire', function () {
    hookTransactionFailure();
    describe('for a user that should have jobs', function () {
      hookJobStatus({ jobID, username: 'joe' });
      it('returns an internal server error status code', function () {
        expect(this.res.statusCode).to.equal(500);
      });
      it('includes an error message in JSON format indicating a server error', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.ServerError',
          description: 'Error: Internal server error.',
        });
      });
    });
  });

  describe('status updates from non-HTTP backends', function () {
    const collection = 'C1233800302-EEDTEST';
    const variableName = 'red_var';
    const version = '1.0.0';
    describe('when the job has started but not completed', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });

      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');

        it('returns a status field of "running"', function () {
          const job = JSON.parse(this.res.text);
          expect(job.status).to.eql('running');
        });

        it('returns a human-readable message field corresponding to its state', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.include('The job is being processed');
        });

        it('does not supply a link to the STAC catalog', function () {
          const job = JSON.parse(this.res.text);
          expect(job.stac).to.be.undefined;
        });
      });
    });

    describe('when the job has failed to complete', function () {
      StubService.hook({ params: { error: 'something broke' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe2' });
      before(async function () {
        await this.service.complete();
      });

      describe('retrieving its job status', function () {
        hookRedirect('jdoe2');

        it('returns a status field of "failed"', function () {
          const job = JSON.parse(this.res.text);
          expect(job.status).to.eql('failed');
        });

        it('returns a human-readable message field corresponding to its state', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.eql('something broke');
        });

        it('does not supply a link to the STAC catalog', function () {
          const job = JSON.parse(this.res.text);
          expect(job.stac).to.be.undefined;
        });
      });
    });

    describe('when the job has completed successfully', function () {
      StubService.hook({ params: { status: 'successful', argo: 'true' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe3' });
      before(async function () {
        await this.service.complete();
      });

      describe('retrieving its job status', function () {
        hookRedirect('jdoe3');

        it('returns a status field of "successful"', function () {
          const job = JSON.parse(this.res.text);
          expect(job.status).to.eql('successful');
        });

        it('returns a human-readable message field corresponding to its state', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.include('The job has completed successfully');
        });
      });
    });

    describe('when the request is limited by maxResults', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName,
        { username: 'jdoe1', query: { maxResults: 2 } });

      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');

        it('returns a human-readable message field indicating the request has been limited to a subset of the granules', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.equal('CMR query identified 177 granules, but the request has been limited to process only the first 2 granules because you requested 2 maxResults.');
        });
      });
    });
  });

  describe('status updates from HTTP backends', function () {
    const collection = 'C1104-PVC_TS2';
    const variableName = 'all';
    const version = '1.0.0';

    describe('when the job has started but not completed', function () {
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });

      describe('retrieving its job status', function () {
        hookRedirect('jdoe1');

        it('returns a status field of "running"', function () {
          const job = JSON.parse(this.res.text);
          expect(job.status).to.eql('running');
        });

        it('returns a human-readable message field corresponding to its state', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.include('The job is being processed');
        });

        it('does not supply a link to the STAC catalog', function () {
          const job = JSON.parse(this.res.text);
          expect(job.stac).to.be.undefined;
        });
      });
    });

    describe('when the job has failed to complete', function () {
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe2' });
      before(async function () {
        const id = this.res.headers.location.split('/').pop();
        await request(this.frontend)
          .get('/example/status').query({ id, error: 'something broke' });
      });

      describe('retrieving its job status', function () {
        hookRedirect('jdoe2');

        it('returns a status field of "failed"', function () {
          const job = JSON.parse(this.res.text);
          expect(job.status).to.eql('failed');
        });

        it('returns a human-readable message field corresponding to its state', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.eql('something broke');
        });

        it('does not supply a link to the STAC catalog', function () {
          const job = JSON.parse(this.res.text);
          expect(job.stac).to.be.undefined;
        });
      });
    });

    describe('when an incomplete job has provided links as a partial status updates', function () {
      const shortLinks = [
        {
          href: 'http://example.com/1',
          title: 'Example 1',
          type: 'text/plain',
          rel: 'data',
        },
        {
          href: 'http://example.com/2',
          title: 'Example 2',
          type: 'text/ornate',
          rel: 'data',
        },
      ];

      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });
      before(async function () {
        await this.service.sendResponse({ item: shortLinks[0] });
        await this.service.sendResponse({ item: shortLinks[1] });
      });
      hookRedirect('jdoe1');

      it('returns the links in its response', function () {
        const job = new Job(JSON.parse(this.res.text));
        const outputLinks = job.getRelatedLinks('data');
        expect(outputLinks).to.eql(shortLinks);
      });

      it('maintains a status of "running"', function () {
        const job = JSON.parse(this.res.text);
        expect(job.status).to.equal('running');
      });
    });

    describe('when an incomplete job has provided a percentage progress update', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });
      before(async function () {
        await this.service.sendResponse({ progress: 20 });
      });
      hookRedirect('jdoe1');

      it('displays the progress in its response', function () {
        const job = JSON.parse(this.res.text);
        expect(job.progress).to.equal(20);
      });

      it('maintains a status of "running"', function () {
        const job = JSON.parse(this.res.text);
        expect(job.status).to.equal('running');
      });
    });

    describe('when an incomplete job provides an out-of-range percentage', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });
      before(async function () {
        this.res = await this.service.sendResponse({ progress: -1 }).ok(() => true);
      });

      it('rejects the update', async function () {
        expect(this.res.status).to.equal(400);
        const body = JSON.parse(this.res.text);
        expect(body.message).to.equal('Job is invalid: ["Invalid progress -1. Job progress must be between 0 and 100."]');
      });
    });

    describe('when an incomplete job provides a non-numeric percentage', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });
      before(async function () {
        this.res = await this.service.sendResponse({ progress: 'garbage' }).ok(() => true);
      });

      it('rejects the update', async function () {
        expect(this.res.status).to.equal(400);
        const body = JSON.parse(this.res.text);
        expect(body.message).to.equal('Job is invalid: ["Job progress must be between 0 and 100"]');
      });
    });

    describe('when a job has provided an S3 URL as a result', function () {
      const s3Uri = 's3://example-bucket/public/example/path.tif';
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });
      before(async function () {
        await this.service.sendResponse({ item: { href: s3Uri } });
      });

      // HARMONY-770 AC 1
      describe('when linkType is unset', function () {
        hookRedirect('jdoe1');
        itProvidesAWorkingHttpUrl('jdoe1');
      });

      describe('when linkType is set', function () {
        describe('and the linkType is s3', function () {
          hookUrl(function () {
            const { location } = this.res.headers;
            return location;
          }, 'jdoe1', { linkType: 's3' });
          // HARMONY-770 AC 4
          it('provides s3 links for data', function () {
            const job = new Job(JSON.parse(this.res.text));
            const jobOutputLinks = job.getRelatedLinks('data');
            expect(jobOutputLinks[0].href).to.match(/^s3/);
            expect(jobOutputLinks[0].href).to.have.string('s3://example-bucket/public/example/path.tif');
          });
        });

        // HARMONY-770 AC 3
        describe('and the linkType is http', function () {
          hookUrl(function () {
            const { location } = this.res.headers;
            return location;
          }, 'jdoe1', { linkType: 'http' });

          itProvidesAWorkingHttpUrl('jdoe1');
        });
        /// HARMONY-770 AC 3
        describe('and the linkType is https', function () {
          hookUrl(function () {
            const { location } = this.res.headers;
            return location;
          }, 'jdoe1', { linkType: 'https' });

          itProvidesAWorkingHttpUrl('jdoe1');
        });

        describe('and the linkType is capitalized', function () {
          hookUrl(function () {
            const { location } = this.res.headers;
            return location;
          }, 'jdoe1', { linkType: 'S3' });
          // HARMONY-770 AC 4
          it('linkType is case insensitive', function () {
            const job = new Job(JSON.parse(this.res.text));
            const jobOutputLinks = job.getRelatedLinks('data');
            expect(jobOutputLinks[0].href).to.match(/^s3/);
            expect(jobOutputLinks[0].href).to.have.string('s3://example-bucket/public/example/path.tif');
          });
        });
      });
    });

    describe('when linkType is set to something other than http, https, or s3', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });
      before(async function () {
        await this.service.sendResponse({});
      });

      hookUrl(function () {
        const { location } = this.res.headers;
        return location;
      }, 'jdoe1', { linkType: 'foo' });

      // HARMONY-770 AC 5
      it('returns an informative error', function () {
        expect(this.res.error.status).to.equal(400);
        expect(this.res.error.text).to.match(/^{"code":"harmony.RequestValidationError","description":"Error: Invalid linkType 'foo' must be http, https, or s3"}/);
      });
    });

    // HARMONY-770 AC 9
    describe('when a job has provided an S3 URL result with application/x-zarr mime type', function () {
      const s3Uri = 's3://example-bucket/public/example/path.tif';
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });
      before(async function () {
        await this.service.sendResponse({ item: { href: s3Uri, type: 'application/x-zarr' } });
      });

      describe('when linkType is unset', function () {
        hookRedirect('jdoe1');
        itReturnsUnchangedDataLinksForZarr(s3Uri);
      });

      describe('when linkType is s3', function () {
        hookUrl(function () {
          const { location } = this.res.headers;
          return location;
        }, 'jdoe1', { linkType: 's3' });
        itReturnsUnchangedDataLinksForZarr(s3Uri);
      });

      describe('when linkType is http', function () {
        hookUrl(function () {
          const { location } = this.res.headers;
          return location;
        }, 'jdoe1', { linkType: 'http' });
        itReturnsUnchangedDataLinksForZarr(s3Uri);
      });

      describe('when linkType is https', function () {
        hookUrl(function () {
          const { location } = this.res.headers;
          return location;
        }, 'jdoe1', { linkType: 'https' });
        itReturnsUnchangedDataLinksForZarr(s3Uri);
      });
    });

    describe('when a job has links with temporal and bbox fields', function () {
      StubService.hook({ params: { status: 'successful' } });
      hookRangesetRequest(version, collection, variableName, { username: 'jdoe1' });
      before(async function () {
        await this.service.sendResponse({
          item: {
            href: 'https://example.com',
            type: 'image/gif',
            bbox: '-10,-10,10,10',
            temporal: '2020-01-01T00:00:00.000Z,2020-01-02T00:00:00.000Z',
          },
        });
      });
      hookRedirect('jdoe1');

      it('includes the temporal range in the link', function () {
        const job = new Job(JSON.parse(this.res.text));
        const link = job.getRelatedLinks('data')[0];
        expect(link.temporal).to.eql({ start: '2020-01-01T00:00:00.000Z', end: '2020-01-02T00:00:00.000Z' });
      });

      it('includes the bbox in the link', function () {
        const job = new Job(JSON.parse(this.res.text));
        const link = job.getRelatedLinks('data')[0];
        expect(link.bbox).to.eql([-10, -10, 10, 10]);
      });
    });

    describe('when the job has completed successfully', function () {
      const query = { subset: ['lat(-80:80)', 'lon(-100:100)'] };
      hookRangesetRequest(version, collection, variableName, { query, username: 'jdoe3' });
      before(async function () {
        const id = this.res.headers.location.split('/').pop();
        await request(this.frontend)
          .get('/example/status').query({ id, status: 'successful', argo: 'true' });
      });

      describe('retrieving its job status', function () {
        hookRedirect('jdoe3');

        it('returns a status field of "successful"', function () {
          const job = JSON.parse(this.res.text);
          expect(job.status).to.eql('successful');
        });

        it('returns a human-readable message field corresponding to its state', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.include('The job has completed successfully');
        });

        itIncludesRequestUrl('/C1104-PVC_TS2/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?subset=lat(-80%3A80)&subset=lon(-100%3A100)');
      });
    });

    describe('warning messages', function () {
      describe('when maxResults is not specified and the CMR hits is greater than the max granule limit', function () {
        before(function () {
          this.glStub = stub(env, 'maxGranuleLimit').get(() => 2);
        });
        after(function () {
          this.glStub.restore();
        });

        StubService.hook({ params: { status: 'successful' } });
        hookRangesetRequest(version, collection, variableName, { username: 'jdoe3' });
        hookRedirect('jdoe3');

        it('returns a warning message about system limits', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 2 granules because of system constraints\.$/);
        });

        it('limits the input granules to the system limit', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(2);
        });
      });

      describe('when the maxResults and the granule limit are both greater than the CMR hits', function () {
        before(function () {
          this.glStub = stub(env, 'maxGranuleLimit').get(() => 200);
        });
        after(function () {
          this.glStub.restore();
        });

        StubService.hook({ params: { status: 'successful' } });
        hookRangesetRequest(version, collection, variableName, { username: 'jdoe3', query: { maxResults: 200 } });
        hookRedirect('jdoe3');

        it('does not return a warning message', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.equal('The job is being processed');
        });

        it('includes all of the granules', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.be.greaterThan(100);
        });
      });

      describe('when the maxResults is less than the granule limit and less than the CMR hits', function () {
        before(function () {
          this.glStub = stub(env, 'maxGranuleLimit').get(() => 200);
        });
        after(function () {
          this.glStub.restore();
        });

        StubService.hook({ params: { status: 'successful' } });
        hookRangesetRequest(version, collection, variableName, { username: 'jdoe3', query: { maxResults: 30 } });
        hookRedirect('jdoe3');

        it('returns a warning message about maxResults limiting the number of results', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 30 granules because you requested 30 maxResults\.$/);
        });

        it('limits the input granules to the maxResults value', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(30);
        });
      });

      describe('when the maxResults is greater than the CMR hits, but the CMR hits is greater than the system limit', function () {
        before(function () {
          this.glStub = stub(env, 'maxGranuleLimit').get(() => 25);
        });
        after(function () {
          this.glStub.restore();
        });

        StubService.hook({ params: { status: 'successful' } });
        hookRangesetRequest(version, collection, variableName, { username: 'jdoe3', query: { maxResults: 200 } });
        hookRedirect('jdoe3');

        it('returns a warning message about maxResults limiting the number of results', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 25 granules because of system constraints\.$/);
        });

        it('limits the input granules to the system limit', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(25);
        });
      });

      describe('when the maxResults is equal to the granule limit, and less than the CMR hits', function () {
        before(function () {
          this.glStub = stub(env, 'maxGranuleLimit').get(() => 100);
        });
        after(function () {
          this.glStub.restore();
        });

        StubService.hook({ params: { status: 'successful' } });
        hookRangesetRequest(version, collection, variableName, { username: 'jdoe3', query: { maxResults: 100 } });
        hookRedirect('jdoe3');

        it('returns a warning message about maxResults limiting the number of results', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.match(/^CMR query identified \d{3,} granules, but the request has been limited to process only the first 100 granules because of system constraints\.$/);
        });

        it('limits the input granules to the system limit and maxResults limit', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(100);
        });
      });

      describe('when maxResults, the granule limit, and the CMR hits are all equal', function () {
        before(function () {
          this.glStub = stub(env, 'maxGranuleLimit').get(() => 125);
        });
        after(function () {
          this.glStub.restore();
        });

        StubService.hook({ params: { status: 'successful' } });
        hookRangesetRequest(version, collection, variableName, { username: 'jdoe3', query: { maxResults: 125 } });
        hookRedirect('jdoe3');

        it('does not return a warning message', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.equal('The job is being processed');
        });

        it('includes all of the granules', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(125);
        });
      });

      describe('when multiple collections share the same short name', function () {
        const query = { subset: ['time("1998-01-01T00:00:00Z":"2021-01-01T00:00:00Z")'] };

        StubService.hook({ params: { status: 'successful' } });
        hookRangesetRequest(version, 'harmony_example', variableName, { username: 'jdoe3', query });
        hookRedirect('jdoe3');

        it('returns a warning message about the multiple matching collections', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.contain('There were 3 collections that matched the provided short name harmony_example. See https://cmr.uat.earthdata.nasa.gov/concepts/C1234088182-EEDTEST for details on the selected collection. The version ID for the selected collection is 2. To use a different collection submit a new request specifying the desired CMR concept ID instead of the collection short name.');
        });

        it('chooses the first collection that is configured for harmony', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.contain('C1234088182-EEDTEST');
        });

        it('includes all of the granules', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(176);
        });
      });

      describe('when multiple collections share the same short name and the granule limit is exceeded', function () {
        before(function () {
          this.glStub = stub(env, 'maxGranuleLimit').get(() => 2);
        });
        after(function () {
          this.glStub.restore();
        });

        StubService.hook({ params: { status: 'successful' } });
        hookRangesetRequest(version, 'harmony_example', variableName, { username: 'jdoe3' });
        hookRedirect('jdoe3');

        it('returns a warning message that includes both warnings', function () {
          const job = JSON.parse(this.res.text);
          expect(job.message).to.equal('There were 3 collections that matched the provided short name harmony_example. See https://cmr.uat.earthdata.nasa.gov/concepts/C1234088182-EEDTEST for details on the selected collection. The version ID for the selected collection is 2. To use a different collection submit a new request specifying the desired CMR concept ID instead of the collection short name. CMR query identified 176 granules, but the request has been limited to process only the first 2 granules because of system constraints.');
        });

        it('limits the input granules to the system limit', function () {
          const job = JSON.parse(this.res.text);
          expect(job.numInputGranules).to.equal(2);
        });
      });
    });
  });
});
