const { describe, it } = require('mocha');
const { expect } = require('chai');
const Job = require('../../app/models/job');
const catalog = require('../../app/frontends/stac-catalog');

// Prop for testing
const jobProps = {
  jobID: '1234',
  request: 'example.com',
  links: [
    {
      href: 'file1.nc',
      title: 'Item #1',
      type: 'application/nc',
      bbox: [-80, -30, -100, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      href: 'file_1.png',
      title: 'Item #2',
      type: 'image/png',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
  ],
};

describe('stac-catalog', function () {
  describe('catalog creation with invalid argument', function () {
    const job = { jobID: 1 };
    it('should fail', function (done) {
      expect(function () { catalog.create(job); }).to.throw();
      done();
    });
  });

  describe('catalog creation with an object matching Harmony Job properties', function () {
    it('should fail', function (done) {
      expect(function () { catalog.create(jobProps); }).to.throw();
      done();
    });
  });

  describe('catalog creation with a Harmony Job object', function () {
    const job = new Job(jobProps);
    let jsonObj = {};
    it('created Harmony STAC Catalog', function (done) {
      expect(function () { jsonObj = catalog.create(job); }).to.not.throw();
      done();
    });
    it('catalog ID matches Job ID', function (done) {
      expect(jsonObj.id).to.equal(jobProps.jobID);
      done();
    });
  });
});
