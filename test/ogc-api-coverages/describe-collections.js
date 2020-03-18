const { describe, it } = require('mocha');
const { expect } = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { hookDescribeCollectionRequest, hookDescribeCollectionsRequest } = require('../helpers/ogc-api-coverages');
const { generateExtent } = require('../../app/frontends/ogc-coverages/describe-collections');

describe('OGC API Coverages - describeCollections', function () {
  const collection = 'C1215669046-GES_DISC';
  const version = '1.0.0';

  hookServersStartStop();

  describe('when provided a valid EOSDIS collection', function () {
    hookDescribeCollectionsRequest(collection, version);

    it('includes an OGC collection for every variable in the EOSDIS collection', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.collections.length).to.equal(102);
    });

    it('includes a link to the OGC coverages landing page', function () {
      const listing = JSON.parse(this.res.text);
      const rootLink = listing.links[0];
      expect(rootLink.title).to.equal('OGC coverages API root for AIRX3STD v006');
      expect(rootLink.href).to.contain('C1215669046-GES_DISC/ogc-api-coverages/1.0.0');
      expect(rootLink.type).to.equal('application/json');
      expect(rootLink.rel).to.equal('root');
    });

    it('includes a link to the collections listing page', function () {
      const listing = JSON.parse(this.res.text);
      const selfLink = listing.links[1];
      expect(selfLink.title).to.equal('Collections listing for AIRX3STD v006');
      expect(selfLink.href).to.contain('C1215669046-GES_DISC/ogc-api-coverages/1.0.0/collections');
      expect(selfLink.type).to.equal('application/json');
      expect(selfLink.rel).to.equal('self');
    });

    describe('when inspecting a single collection object in the response', function () {
      it('includes an id', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.id).to.equal('C1215669046-GES_DISC/V1224729877-GES_DISC');
      });

      it('includes a title', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.title).to.equal('CloudFrc_A AIRX3STD v006');
      });

      it('includes a description', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.description).to.equal('Cloud Fraction Ascending AIRX3STD v006 (NASA/GSFC/SED/ESD/GCDC/GESDISC)');
      });

      it('includes links to make a rangeset request for the variable', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        const firstLink = firstItem.links[0];
        expect(firstItem.links.length).to.equal(1);
        expect(firstLink.title).to.equal('Perform rangeset request for CloudFrc_A');
        expect(firstLink.href).to.contain('/C1215669046-GES_DISC/ogc-api-coverages/1.0.0/collections/CloudFrc_A/coverage/rangeset');
      });

      it('includes a spatial extent', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.extent.spatial).to.eql({
          bbox: [-90, -180, 90, 180],
          crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        });
      });

      it('includes a temporal extent', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.extent.temporal).to.eql({
          interval: ['2002-08-31T00:00:00.000Z', '2016-09-25T23:59:59.000Z'],
          trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
        });
      });

      it('includes an item type of variable', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.itemType).to.equal('Variable');
      });
    });
  });
  describe('Validation', function () {
    describe('When requesting an invalid response format', function () {
      hookDescribeCollectionsRequest(collection, version, { f: 'bad-value' });
      it('returns a 400 "Bad Request" error', function () {
        expect(this.res.status).to.equal(400);
      });
      it('includes a message indicating the invalid "f" parameter', function () {
        const body = JSON.parse(this.res.text);
        expect(body).to.eql({
          code: 'openapi.ValidationError',
          description: 'Error: query parameter "f" should be equal to one of the allowed values',
        });
      });
    });
    describe('When requesting an html response format', function () {
      hookDescribeCollectionsRequest(collection, version, { f: 'html' });
      it('returns a 400 "Bad Request" error', function () {
        expect(this.res.status).to.equal(400);
      });
      it('includes a message indicating that only json is supported', function () {
        const body = JSON.parse(this.res.text);
        expect(body).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Unsupported format "html". Currently only the json format is supported.',
        });
      });
    });
    describe('When requesting a JSON response format', function () {
      hookDescribeCollectionsRequest(collection, version, { f: 'json' });
      it('returns a 200 successful response', function () {
        expect(this.res.status).to.equal(200);
      });
      it('returns valid JSON listing', function () {
        const body = JSON.parse(this.res.text);
        expect(Object.keys(body)).to.eql(['links', 'collections']);
      });
    });
  });
});

describe('OGC API Coverages - describeCollection', function () {
  const collection = 'C1215669046-GES_DISC';
  const version = '1.0.0';
  const variableName = 'CloudFrc_A';

  hookServersStartStop();

  describe('when provided a valid EOSDIS collection', function () {
    hookDescribeCollectionRequest(collection, version, variableName);

    it('includes an OGC collection for every variable in the CMR collection', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.collections.length).to.equal(102);
    });

    it('includes a link to the coverages landing page', function () {
      const listing = JSON.parse(this.res.text);
      const rootLink = listing.links[0];
      expect(rootLink.title).to.equal('OGC coverages API root for AIRX3STD v006');
      expect(rootLink.href).to.contain('C1215669046-GES_DISC/ogc-api-coverages/1.0.0');
      expect(rootLink.type).to.equal('application/json');
      expect(rootLink.rel).to.equal('root');
    });

    it('includes a link to the collections listing page', function () {
      const listing = JSON.parse(this.res.text);
      const selfLink = listing.links[1];
      expect(selfLink.title).to.equal('Collections listing for AIRX3STD v006');
      expect(selfLink.href).to.contain('C1215669046-GES_DISC/ogc-api-coverages/1.0.0/collections');
      expect(selfLink.type).to.equal('application/json');
      expect(selfLink.rel).to.equal('self');
    });

    describe('when inspecting a single collection object in the response', function () {
      it('includes an id', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.id).to.equal('C1215669046-GES_DISC/V1224729877-GES_DISC');
      });

      it('includes a title', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.title).to.equal('CloudFrc_A AIRX3STD v006');
      });

      it('includes a description', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.description).to.equal('Cloud Fraction Ascending AIRX3STD v006 (NASA/GSFC/SED/ESD/GCDC/GESDISC)');
      });

      it('includes links to make a rangeset request for the variable', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        const firstLink = firstItem.links[0];
        expect(firstItem.links.length).to.equal(1);
        expect(firstLink.title).to.equal('Perform rangeset request for CloudFrc_A');
        expect(firstLink.href).to.contain('/C1215669046-GES_DISC/ogc-api-coverages/1.0.0/collections/CloudFrc_A/coverage/rangeset');
      });

      it('includes a spatial extent', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.extent.spatial).to.eql({
          bbox: [-90, -180, 90, 180],
          crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        });
      });

      it('includes a temporal extent', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.extent.temporal).to.eql({
          interval: ['2002-08-31T00:00:00.000Z', '2016-09-25T23:59:59.000Z'],
          trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
        });
      });

      it('includes an item type of variable', function () {
        const listing = JSON.parse(this.res.text);
        const firstItem = listing.collections[0];
        expect(firstItem.itemType).to.equal('Variable');
      });
    });
  });
});

describe('OGC API Coverages - describeCollections - generateExtent', function () {
  const bboxString = '-89.99, -179.9, 90, 180';
  const temporalStart = '2002-08-31T00:00:00.000Z';
  const temporalEnd = '2016-09-25T23:59:59.000Z';

  describe('contains spatial bounding box, temporal start, and temporal end', function () {
    const result = generateExtent({
      boxes: [bboxString],
      time_start: temporalStart,
      time_end: temporalEnd,
    });
    it('includes correct spatial and temporal bounds', function () {
      expect(result).to.eql({
        spatial: {
          bbox: [-89.99, -179.9, 90, 180],
          crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        },
        temporal: {
          interval: ['2002-08-31T00:00:00.000Z', '2016-09-25T23:59:59.000Z'],
          trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
        },
      });
    });
  });

  describe('contains spatial bounding box and temporal start, but no temporal end', function () {
    const result = generateExtent({ boxes: [bboxString], time_start: temporalStart });
    it('includes correct spatial and temporal bounds', function () {
      expect(result).to.eql({
        spatial: {
          bbox: [-89.99, -179.9, 90, 180],
          crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        },
        temporal: {
          interval: ['2002-08-31T00:00:00.000Z', undefined],
          trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
        },
      });
    });
  });

  describe('contains spatial bounding box and temporal end, but no temporal start', function () {
    const result = generateExtent({ boxes: [bboxString], time_end: temporalEnd });
    it('includes correct spatial and temporal bounds', function () {
      expect(result).to.eql({
        spatial: {
          bbox: [-89.99, -179.9, 90, 180],
          crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        },
        temporal: {
          interval: [undefined, '2016-09-25T23:59:59.000Z'],
          trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
        },
      });
    });
  });

  describe('contains spatial bounding box and no temporal', function () {
    const result = generateExtent({ boxes: [bboxString] });
    it('includes correct spatial and temporal bounds', function () {
      expect(result).to.eql({
        spatial: {
          bbox: [-89.99, -179.9, 90, 180],
          crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        },
        temporal: undefined,
      });
    });
  });

  describe('contains a temporal start and temporal end, but no spatial', function () {
    const result = generateExtent({ time_start: temporalStart, time_end: temporalEnd });
    it('includes correct spatial and temporal bounds', function () {
      expect(result).to.eql({
        spatial: undefined,
        temporal: {
          interval: ['2002-08-31T00:00:00.000Z', '2016-09-25T23:59:59.000Z'],
          trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
        },
      });
    });
  });

  describe('contains no temporal and no spatial', function () {
    const result = generateExtent({});
    it('includes no spatial or temporal', function () {
      expect(result).to.eql(undefined);
    });
  });
});
