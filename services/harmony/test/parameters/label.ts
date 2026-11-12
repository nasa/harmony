
import { expect } from 'chai';
import { describe, it } from 'mocha';
import request, { Test } from 'supertest';

import { Job } from '../../app/models/job';
import db from '../../app/util/db';
import { auth } from '../helpers/auth';
import { hookRedirect } from '../helpers/hooks';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import { hookEdrRequest } from '../helpers/ogc-api-edr';
import hookServersStartStop from '../helpers/servers';
import { generateRandomString } from '../helpers/string';
import StubService from '../helpers/stub-service';

const collection = 'C1233800302-EEDTEST';
const granuleId = 'G1233800343-EEDTEST';
const variableId = 'V1233801695-EEDTEST';
const pointWKT = 'POINT (-40 10)';
const edrQuery = {
  'parameter-name': variableId,
  granuleId,
  crs: 'EPSG:4326',
  coords: pointWKT,
  datetime: '2020-01-01T00:00:00.000Z/2020-01-02T01:00:00.000Z',
  interpolation: 'near',
  scaleExtent: '0,2500000.3,1500000,3300000',
  scaleSize: '1.1,2',
  height: 500,
  width: 1000,
  f: 'image/png',
  skipPreview: true,
  forceAsync: true,
};

const hookPartials = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'OGC Coverages': (label: string | string[]): void => {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { label }, username: 'joe' });
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'OGC EDR (GET)': (label: string | string[]): void => {
    hookEdrRequest('position', '1.1.0', collection, { query: { ...edrQuery, label }, username: 'joe' });
  },
};

describe('labels', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  for (const apiType of Object.keys(hookPartials)) {
    describe(`${apiType}`, function () {

      describe('when passing in a single label with the request', function () {

        hookPartials[apiType](['foo']);
        hookRedirect('joe');

        it('returns a 200 status code for the request', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('adds the label to the job', async function () {
          const jobStatus = JSON.parse(this.res.text);
          const job = await Job.byJobID(db, jobStatus.jobID, false, true, false);
          expect(job.job.labels).deep.equal(['foo']);
        });
      });
    });

    describe('when passing in multiple labels with the request', function () {

      hookPartials[apiType](['bar', 'buzz']);
      hookRedirect('joe');

      it('returns a 200 status code for the request', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('adds the labels to the job', async function () {
        const jobStatus = JSON.parse(this.res.text);
        const job = await Job.byJobID(db, jobStatus.jobID, false, true, false);
        expect(job.job.labels).deep.equal(['bar', 'buzz']);
      });
    });

    describe('when passing in mixed case labels with the request', function () {

      hookPartials[apiType](['Bar', 'buzz', 'bAZz']);
      hookRedirect('joe');

      it('returns a 200 status code for the request', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('converts the labels to lowercase', async function () {
        const jobStatus = JSON.parse(this.res.text);
        const job = await Job.byJobID(db, jobStatus.jobID, false, true, false);
        expect(job.job.labels).deep.equal(['bar', 'bazz', 'buzz']);
      });
    });

    describe('when passing in labels with non-word characters with the request', function () {

      hookPartials[apiType](['b🙂ar', 'bu#!zz']);
      hookRedirect('joe');

      it('returns a 200 status code for the request', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('adds the labels to the job', async function () {
        const jobStatus = JSON.parse(this.res.text);
        const job = await Job.byJobID(db, jobStatus.jobID, false, true, false);
        expect(job.job.labels).deep.equal(['bu#!zz', 'b🙂ar']);
      });
    });

    describe('when passing in labels with leading or trailing whitespace with the request', function () {

      hookPartials[apiType](['  bar', 'buzz    ', '   bazz ', '\t foo\t  ']);
      hookRedirect('joe');

      it('trims the whitespace and adds the labels to the job', async function () {
        const jobStatus = JSON.parse(this.res.text);
        const job = await Job.byJobID(db, jobStatus.jobID, false, true, false);
        expect(job.job.labels).deep.equal(['bar', 'bazz', 'buzz', 'foo']);
      });
    });

    describe('when passing in repeated labels with the request', function () {

      hookPartials[apiType](['bar', 'buzz', 'bar', '   buzz ']);
      hookRedirect('joe');

      it('it deduplicates the labels', async function () {
        const jobStatus = JSON.parse(this.res.text);
        const job = await Job.byJobID(db, jobStatus.jobID, false, true, false);
        expect(job.job.labels).deep.equal(['bar', 'buzz']);
      });
    });

    describe('when passing in labels with just whitespace with the request', function () {

      hookPartials[apiType](['foo', '  \t \t  ']);

      it('returns a 400 status code for the request', async function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.include('Labels must contain at least one non-whitespace character');
      });
    });

    describe('when passing in labels that are more than 255 characters long', async function () {
      // a long label that does not contain commas
      const veryLongLabel = generateRandomString(256, [0x002C]);
      hookPartials[apiType](['b🙂ar', veryLongLabel]);

      it('returns a 400 status code for the request', async function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.include('Labels may not exceed 255 characters in length.');
      });
    });

    describe('when including a comma within one of several labels', async function () {
      const label = ['good', 'ok,comma'];
      hookPartials[apiType](label);
      hookRedirect('joe');

      it('returns a 200 status code for the request', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('preserves the comma within the label', async function () {
        const jobStatus = JSON.parse(this.res.text);
        const job = await Job.byJobID(db, jobStatus.jobID, false, true, false);
        expect(job.job.labels).to.have.members(['good', 'ok,comma']);
      });
    });
  }
});

// Requests are sent as raw URLs so that literal and URL-encoded commas are sent exactly as given
describe('labels containing commas', function () {
  const coveragesPath = `/${collection}/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset`;
  const edrPath = `/ogc-api-edr/1.1.0/collections/${collection}/cube`;
  const boundingBoxLabel = 'boundingbox: {"e":-109.42,"n":50.48,"w":-109.53,"s":50.45}';
  const encodedBoundingBoxLabel = encodeURIComponent(boundingBoxLabel);

  hookServersStartStop();

  const tests: { description: string; makeRequest: (app) => Test; expectedLabels: string[] }[] = [{
    description: 'OGC Coverages GET with labels separated by a literal comma',
    makeRequest: (app): Test => request(app).get(`${coveragesPath}?granuleId=${granuleId}&label=eed-edsc-prod,edsc-id=5434533836`),
    expectedLabels: ['eed-edsc-prod', 'edsc-id=5434533836'],
  }, {
    description: 'OGC Coverages GET with a URL-encoded comma within a label',
    makeRequest: (app): Test => request(app).get(`${coveragesPath}?granuleId=${granuleId}&label=${encodedBoundingBoxLabel}`),
    expectedLabels: [boundingBoxLabel],
  }, {
    description: 'OGC Coverages GET with repeated labels, one containing a URL-encoded comma',
    makeRequest: (app): Test => request(app).get(`${coveragesPath}?granuleId=${granuleId}&label=foo&label=${encodedBoundingBoxLabel}`),
    expectedLabels: ['foo', boundingBoxLabel],
  }, {
    description: 'OGC Coverages POST with a single comma-separated label form field',
    makeRequest: (app): Test => request(app).post(coveragesPath).field('granuleId', granuleId).field('label', 'eed-edsc-prod,edsc-id=5434533836'),
    expectedLabels: ['eed-edsc-prod', 'edsc-id=5434533836'],
  }, {
    description: 'OGC Coverages POST with multiple label form fields, one containing a comma',
    makeRequest: (app): Test => request(app).post(coveragesPath).field('granuleId', granuleId).field('label', 'eed-edsc-prod').field('label', boundingBoxLabel),
    expectedLabels: ['eed-edsc-prod', boundingBoxLabel],
  }, {
    description: 'OGC EDR GET with labels separated by a literal comma',
    makeRequest: (app): Test => request(app).get(`${edrPath}?bbox=-180,-90,180,90&granuleId=${granuleId}&label=eed-edsc-prod,edsc-id=5434533836`),
    expectedLabels: ['eed-edsc-prod', 'edsc-id=5434533836'],
  }, {
    description: 'OGC EDR GET with repeated labels, one containing a URL-encoded comma',
    makeRequest: (app): Test => request(app).get(`${edrPath}?bbox=-180,-90,180,90&granuleId=${granuleId}&label=foo&label=${encodedBoundingBoxLabel}`),
    expectedLabels: ['foo', boundingBoxLabel],
  }];

  for (const { description, makeRequest, expectedLabels } of tests) {
    describe(description, function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      before(async function () {
        await makeRequest(this.frontend).use(auth({ username: 'joe' }));
        this.job = (await Job.byJobID(db, this.service.operation.requestId, false, true, false)).job;

        // Resubmit the request URL shown for the job, as when a user clicks the job status link
        const requestUrl = new URL(this.job.request);
        await request(this.frontend).get(requestUrl.pathname + requestUrl.search).use(auth({ username: 'joe' }));
        this.resubmittedJob = (await Job.byJobID(db, this.service.operation.requestId, false, true, false)).job;
      });
      after(function () {
        delete this.job;
        delete this.resubmittedJob;
      });

      it('adds the expected labels to the job', function () {
        expect(this.job.labels).to.have.members(expectedLabels);
        expect(this.job.labels.length).to.equal(expectedLabels.length);
      });

      it('creates a new job with the same labels when the job request URL is resubmitted', function () {
        expect(this.resubmittedJob.jobID).to.not.equal(this.job.jobID);
        expect(this.resubmittedJob.labels).to.have.members(expectedLabels);
        expect(this.resubmittedJob.labels.length).to.equal(expectedLabels.length);
      });
    });
  }
});
