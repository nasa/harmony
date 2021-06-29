import { describe, it } from 'mocha';
import { expect } from 'chai';
import { JobStatus } from 'models/job';
import create, { SerializableCatalog } from 'frontends/stac-catalog';
import { buildJob } from 'test/helpers/jobs';
import { linksWithStacData } from 'util/stac';

// Prop for testing
const jobProps = {
  requestId: '1234',
  request: 'example.com',
  username: 'jdoe',
  progress: 100,
  message: 'Success',
  status: JobStatus.SUCCESSFUL,
  numInputGranules: 2,
  links: [
    {
      href: 'file_1.nc',
      title: 'Item #1',
      rel: 'data',
      type: 'application/nc',
      bbox: [-80, -30, -100, 20],
      temporal: {
        start: new Date('1996-10-15T00:05:32.000Z'),
        end: new Date('1996-11-15T00:05:32.000Z'),
      },
    },
    {
      href: 'file_2.png',
      title: 'Item #2',
      rel: 'data',
      type: 'image/png',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: new Date('1996-10-15T00:05:32.000Z'),
        end: new Date('1996-11-15T00:05:32.000Z'),
      },
    },
    {
      href: 'http://data.example.org/',
      title: 'this catalog',
      rel: 'self',
      type: 'application/json',
    },
  ],
};

describe('stac-catalog', function () {
  describe('catalog creation with a Harmony Job object', function () {
    const job = buildJob(jobProps);
    let jsonObj: SerializableCatalog;
    it('created Harmony STAC Catalog', function () {
      expect(function () {
        const serializedJob = job.serialize();
        jsonObj = create(
          serializedJob.jobID, serializedJob.request, linksWithStacData(job.links), [],
        );
      }).to.not.throw();
    });
    it('catalog ID matches Job ID', function () {
      expect(jsonObj.id).to.equal(jobProps.requestId);
    });
    it('includes the expected links', function () {
      expect(jsonObj.links).to.eql([
        { href: '.', rel: 'root', title: 'root' },
        { href: './0', rel: 'item', title: 'Item #1' },
        { href: './1', rel: 'item', title: 'Item #2' },
      ]);
    });
    it('has the proper description', function () {
      expect(jsonObj.description).to.equal('Harmony output for example.com');
    });
  });
});
