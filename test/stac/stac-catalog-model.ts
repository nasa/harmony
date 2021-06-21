import { describe, it } from 'mocha';
import { expect } from 'chai';
import { JobStatus } from 'models/job';
import create, { SerializableCatalog } from 'frontends/stac-catalog';
import { buildJob } from 'test/helpers/jobs';

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
      expect(function () { jsonObj = create(job.serialize()); }).to.not.throw();
    });
    it('catalog ID matches Job ID', function () {
      expect(jsonObj.id).to.equal(jobProps.requestId);
    });
    it('has links', function () {
      expect(jsonObj.links.length).to.equal(4);
    });
    it('has link with an item', function () {
      expect(jsonObj.links[3].rel).to.equal('item');
    });
    it('has link with href to item index', function () {
      expect(jsonObj.links[3].href).to.equal('./1');
    });
  });
});
