import { expect } from 'chai';
import { describe, it } from 'mocha';
import { generateExtent } from '../../app/frontends/ogc-coverages/describe-collections';
import { hookDescribeCollectionRequest, hookDescribeCollectionsRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import { ServiceConfig } from '../../app/models/services/base-service';
import { hookServices } from '../helpers/stub-service';

describe('OGC API Coverages - describeCollections', function () {
  const collection = 'C1244141250-EEDTEST';
  const version = '1.0.0';

  hookServersStartStop();

  describe('when the service config defines the variables for the collection', function () {
    const serviceConfigs: ServiceConfig<unknown>[] = [
      {
        name: 'first-service',
        type: { name: 'turbo' },
        collections: [{
          id: collection,
          variables: ['V1244147073-EEDTEST', 'V1244147075-EEDTEST'],
        }],
      },
    ];

    hookServices(serviceConfigs);
    hookDescribeCollectionsRequest(collection, version);
    it('includes an OGC collection for only the variables in the service config', function () {
      const listing = JSON.parse(this.res.text);
      const variables = listing.collections.map((v) => v.id);
      expect(variables).to.eql([`${collection}/V1244147073-EEDTEST`, `${collection}/V1244147075-EEDTEST`]);
    });
  });

  describe('when provided a valid EOSDIS collection', function () {
    hookDescribeCollectionsRequest(collection, version);

    it('returns a 200 successful response code', function () {
      expect(this.res.status).to.equal(200);
    });

    it('includes an OGC collection for every variable in the EOSDIS collection', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.collections.length).to.equal(10);
    });

    it('includes a link to the OGC coverages landing page', function () {
      const listing = JSON.parse(this.res.text);
      const rootLink = listing.links[0];
      expect(rootLink.title).to.equal('OGC coverages API root for SENTINEL-1_INTERFEROGRAMS v1');
      expect(rootLink.href).to.contain('C1244141250-EEDTEST/ogc-api-coverages/1.0.0');
      expect(rootLink.type).to.equal('application/json');
      expect(rootLink.rel).to.equal('root');
    });

    it('includes a link to the collections listing page', function () {
      const listing = JSON.parse(this.res.text);
      const selfLink = listing.links[1];
      expect(selfLink.title).to.equal('Collections listing for SENTINEL-1_INTERFEROGRAMS v1');
      expect(selfLink.href).to.contain('C1244141250-EEDTEST/ogc-api-coverages/1.0.0/collections');
      expect(selfLink.type).to.equal('application/json');
      expect(selfLink.rel).to.equal('self');
    });

    describe('when inspecting a single collection object in the response', function () {
      it('includes an id', function () {
        const listing = JSON.parse(this.res.text);
        const singleCollection = listing.collections[1];
        expect(singleCollection.id).to.equal('C1244141250-EEDTEST/V1244147073-EEDTEST');
      });

      it('includes a title', function () {
        const listing = JSON.parse(this.res.text);
        const singleCollection = listing.collections[1];
        expect(singleCollection.title).to.equal('science/grids/data/amplitude SENTINEL-1_INTERFEROGRAMS v1');
      });

      it('includes a description', function () {
        const listing = JSON.parse(this.res.text);
        const singleCollection = listing.collections[1];
        expect(singleCollection.description).to.equal('Amplitude SENTINEL-1_INTERFEROGRAMS v1 (EEDTEST)');
      });

      it('includes links to make a rangeset request for the variable', function () {
        const listing = JSON.parse(this.res.text);
        const singleCollection = listing.collections[1];
        const firstLink = singleCollection.links[0];
        expect(singleCollection.links.length).to.equal(1);
        expect(firstLink.title).to.equal('Perform rangeset request for science/grids/data/amplitude');
        expect(firstLink.href).to.contain('/C1244141250-EEDTEST/ogc-api-coverages/1.0.0/collections/science%2Fgrids%2Fdata%2Famplitude/coverage/rangeset');
      });

      it('includes a spatial extent', function () {
        const listing = JSON.parse(this.res.text);
        const singleCollection = listing.collections[1];
        expect(singleCollection.extent.spatial).to.eql({
          bbox: [18.84486, -156.4174, 20.31149, -154.672],
          crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        });
      });

      it('includes a temporal extent', function () {
        const listing = JSON.parse(this.res.text);
        const singleCollection = listing.collections[1];
        expect(singleCollection.extent.temporal).to.eql({
          interval: ['2014-06-15T03:44:43.000Z', null],
          trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
        });
      });

      it('includes an item type of variable', function () {
        const listing = JSON.parse(this.res.text);
        const singleCollection = listing.collections[1];
        expect(singleCollection.itemType).to.equal('Variable');
      });
    });

    describe('when inspecting the first collection in the response', function () {
      it('includes a link to perform a rangeset request requesting all variables', function () {
        const listing = JSON.parse(this.res.text);
        const firstCollection = listing.collections[0];
        const firstLink = firstCollection.links[0];
        expect(firstCollection.links.length).to.equal(1);
        expect(firstLink.title).to.equal('Perform rangeset request for all');
        expect(firstLink.href).to.contain('/C1244141250-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset');
      });
    });
  });

  describe('when provided a collection with a nested variable such as /group/foo/var', function () {
    const nestedCollection = 'C1225776654-ASF';
    const nestedVar = 'science/grids/data/amplitude';
    hookDescribeCollectionsRequest(nestedCollection, version);
    it('URL encodes the nested variable', function () {
      const listing = JSON.parse(this.res.text);
      const amplitudeLink = listing.collections.find((c) => c.title.includes(nestedVar));
      expect(amplitudeLink.links[0].href).to.contain('C1225776654-ASF/ogc-api-coverages/1.0.0/collections/science%2Fgrids%2Fdata%2Famplitude/coverage/rangeset');
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
  const collection = 'C1244141250-EEDTEST';
  const version = '1.0.0';
  const variablePath = 'science/grids/data/amplitude';

  hookServersStartStop();

  describe('when provided a valid EOSDIS collection and variable', function () {
    hookDescribeCollectionRequest(collection, version, variablePath);

    it('returns a 200 successful response code', function () {
      expect(this.res.status).to.equal(200);
    });

    it('includes an id', function () {
      const collectionInfo = JSON.parse(this.res.text);
      expect(collectionInfo.id).to.equal('C1244141250-EEDTEST/V1244147073-EEDTEST');
    });

    it('includes a title', function () {
      const collectionInfo = JSON.parse(this.res.text);
      expect(collectionInfo.title).to.equal('science/grids/data/amplitude SENTINEL-1_INTERFEROGRAMS v1');
    });

    it('includes a description', function () {
      const collectionInfo = JSON.parse(this.res.text);
      expect(collectionInfo.description).to.equal('Amplitude SENTINEL-1_INTERFEROGRAMS v1 (EEDTEST)');
    });

    it('includes links to make a rangeset request for the variable', function () {
      const collectionInfo = JSON.parse(this.res.text);
      const firstLink = collectionInfo.links[0];
      expect(collectionInfo.links.length).to.equal(1);
      expect(firstLink.title).to.equal('Perform rangeset request for science/grids/data/amplitude');
      expect(firstLink.href).to.contain('/C1244141250-EEDTEST/ogc-api-coverages/1.0.0/collections/science%2Fgrids%2Fdata%2Famplitude/coverage/rangeset');
    });

    it('includes a spatial extent', function () {
      const collectionInfo = JSON.parse(this.res.text);
      expect(collectionInfo.extent.spatial).to.eql({
        bbox: [18.84486, -156.4174, 20.31149, -154.672],
        crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
      });
    });

    it('includes a temporal extent', function () {
      const collectionInfo = JSON.parse(this.res.text);
      expect(collectionInfo.extent.temporal).to.eql({
        interval: ['2014-06-15T03:44:43.000Z', null],
        trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
      });
    });

    it('includes an item type of variable', function () {
      const collectionInfo = JSON.parse(this.res.text);
      expect(collectionInfo.itemType).to.equal('Variable');
    });
  });

  describe('when provided a collection without spatial and an empty temporal end', function () {
    const collection2 = 'C1233860183-EEDTEST';
    const blueVar = 'blue_var';

    hookDescribeCollectionRequest(collection2, version, blueVar);
    it('returns a 200 successful response code', function () {
      expect(this.res.status).to.equal(200);
    });

    it('does not include a spatial extent', function () {
      const collectionInfo = JSON.parse(this.res.text);
      expect(collectionInfo.extent.spatial).to.be.undefined;
    });

    it('includes a temporal extent with a start date and null for the end of the interval', function () {
      const collectionInfo = JSON.parse(this.res.text);
      expect(collectionInfo.extent.temporal).to.eql({
        interval: ['1970-06-26T00:00:00.000Z', null],
        trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian',
      });
    });
  });
});

describe('OGC API Coverages - describeCollections - generateExtent', function () {
  const bboxString = '-89.99, -179.9, 90, 180';
  const temporalStart = '2002-08-31T00:00:00.000Z';
  const temporalEnd = '2016-09-25T23:59:59.000Z';
  const baseCollection = { short_name: 'sn', version_id: '001', id: 'C1-FOO' };

  describe('contains spatial bounding box, temporal start, and temporal end', function () {
    const result = generateExtent({
      ...baseCollection,
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
    const result = generateExtent({
      ...baseCollection,
      boxes: [bboxString],
      time_start: temporalStart,
    });
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
    const result = generateExtent({
      ...baseCollection,
      boxes: [bboxString],
      time_end: temporalEnd,
    });
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
    const result = generateExtent({ ...baseCollection, boxes: [bboxString] });
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
    const result = generateExtent({
      ...baseCollection,
      time_start: temporalStart,
      time_end: temporalEnd,
    });
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
    const result = generateExtent({ ...baseCollection });
    it('includes no spatial or temporal', function () {
      expect(result).to.eql(undefined);
    });
  });
});
