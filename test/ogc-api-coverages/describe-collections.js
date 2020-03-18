const { describe, it } = require('mocha');
const { expect } = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { hookDescribeCollectionsRequest } = require('../helpers/ogc-api-coverages');

describe('OGC API Coverages - describeCollections', function () {
  const collection = 'C1215669046-GES_DISC';
  const version = '1.0.0';

  hookServersStartStop();

  describe('when provided a valid collection', function () {
    hookDescribeCollectionsRequest(collection, version);

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
