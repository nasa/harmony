const { describe, it } = require('mocha');
const { expect } = require('chai');
const Job = require('../../app/models/job');
const stacItem = require('../../app/frontends/stac-item');

// Prop for testing
const jobProps = {
  jobID: '1234',
  request: 'example.com',
  createdAt: '2020-02-02T00:00:00Z',
  links: [
    {
      href: 'file_1.nc',
      title: 'Item #1',
      type: 'application/nc',
      rel: 'data',
      bbox: [-80, -30, -100, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      href: 'file_2.png',
      title: 'Item #2',
      type: 'image/png',
      rel: 'data',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      href: 'file_3.json',
      title: 'Item #3',
      type: 'application/json',
      rel: 'data',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      href: 'file_4.csv',
      title: 'Item #4',
      type: 'text/csv',
      rel: 'data',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      // no STAC metadata
      href: 'file_5.nc',
      title: 'Item #1',
      type: 'application/nc',
      rel: 'data',
    },
  ],
};
const job = new Job(jobProps);

describe('stac-item', function () {
  describe('STAC Item creation with invalid argument', function () {
    const obj = { jobID: 1 };
    it('should fail', function () {
      expect(function () { stacItem.create(obj); }).to.throw();
    });
  });

  describe('STAC Item creation with an object matching Harmony Job properties', function () {
    it('should fail', function () {
      expect(function () { stacItem.create(jobProps); }).to.throw();
    });
  });

  describe('STAC Item creation with a Harmony Job object: case of anti-meridian crossing', function () {
    const jsonObj = stacItem.create(job, 0);
    it('Item ID matches Job ID', function () {
      expect(jsonObj.id).to.equal(jobProps.jobID);
    });
    it('has a bounding box that crosses anti-meridian', function () {
      expect(jsonObj.geometry.type).to.equal('MultiPolygon');
    });
    // TODO: [HARMONY-294] validate GeoJSON geometry
    it('has the creation time', function () {
      expect(jsonObj.properties.created).to.equal('2020-02-02T00:00:00Z');
    });
    it('has the representative date time', function () {
      expect(jsonObj.properties.datetime).to.equal('1996-10-15T00:05:32.000Z');
    });
    it('has self-referencing links', function () {
      expect(jsonObj.links.length).to.equal(2);
    });
    it('has roles for the asset', function () {
      expect(jsonObj.assets['file_1.nc'].roles[0]).to.equal('data');
    });
  });

  describe('STAC Item creation with a Harmony Job object: case without anti-meridian crossing', function () {
    const jsonObj = stacItem.create(job, 1);
    it('has a bounding box that doesn\'t anti-meridian', function () {
      expect(jsonObj.geometry.type).to.equal('Polygon');
    });
    it('has roles for the asset', function () {
      expect(jsonObj.assets['file_2.png'].roles[0]).to.equal('overview');
    });
  });

  describe('STAC Item creation with a Harmony Job object: case of metadata assets', function () {
    it('has an asset with metadata role', function () {
      const jsonObj = stacItem.create(job, 2);
      expect(jsonObj.assets['file_3.json'].roles[0]).to.equal('metadata');
    });
  });

  describe('STAC Item creation with a Harmony Job object: case of textual data', function () {
    it('has an text asset with data role', function () {
      const jsonObj = stacItem.create(job, 3);
      expect(jsonObj.assets['file_4.csv'].roles[0]).to.equal('data');
    });
  });
});
