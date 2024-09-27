
import { describe, it } from 'mocha';
import { expect } from 'chai';
import db from '../../app/util/db';
import hookServersStartStop from '../helpers/servers';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import { hookRedirect } from '../helpers/hooks';
import { Job } from '../../app/models/job';
import { hookEdrRequest } from '../helpers/ogc-api-edr';
import { generateRandomString } from '../helpers/string';

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
  'OGC Coverages': (label: string[]): void => {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { label }, username: 'joe' });
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'OGC EDR (GET)': (label: string[]): void => {
    hookEdrRequest('position', '1.1.0', collection, { query: { ...edrQuery, label }, username: 'joe' });
  },
};

describe('labels', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

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
        expect(job.job.labels).deep.equal(['bar', 'buzz', 'bazz']);
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
        expect(job.job.labels).deep.equal(['b🙂ar', 'bu#!zz']);
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
  }
});