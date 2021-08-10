import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { describe, it, xit } from 'mocha';
import * as sinon from 'sinon';
import tmp from 'tmp';
import * as fetch from 'node-fetch';
import { Stream } from 'form-data';
import { queryGranules, queryGranulesScrolling } from '../app/query';

import * as cmr from '../../../app/util/cmr';
import DataOperation from '../../../app/models/data-operation';
import { S3ObjectStore } from '../../../app/util/object-store';
import buildStacSchemaValidator from './helpers/stac';

const geojson = '../../test/resources/complex_multipoly.geojson';

const operation = new DataOperation({
  unencryptedAccessToken: 'shhhhh!',
  sources: [{ collection: 'C001-TEST' }, { collection: 'C002-TEST' }],
});

interface CombinedStream extends Stream {
  resume: () => void;
}

/**
 * Reads a formdata stream into a string
 * @param formdata - the formdata stream
 */
async function formDataToString(formdata: CombinedStream): Promise<string> {
  const chunks = [];
  return new Promise((resolve, reject) => {
    formdata.on('data', (chunk) => { chunks.push(chunk.toString('utf8')); });
    formdata.on('error', reject);
    formdata.on('end', () => { resolve(chunks.join('')); });
    formdata.resume();
  });
}

/**
 * Given an array of args to cmr.fetchPost, return an object mapping arguments to IDs
 * This is a very simple multipart form parser that works for CMR.  Libraries built
 * for either didn't work or required HTTP involvement
 *
 * @param _ - (Ignored path argument)
 * @param formdata - form data being posted to CMR
 * @returns key/value pairs of form data name to value
 */
async function fetchPostArgsToFields(
  [_, formdata],
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const data = (await formDataToString(formdata)).replace(/----+[0-9]+-*\r\n/g, '');
  const result = {};
  const fields = data.split(/Content-Disposition: form-data; name=/g).slice(1);
  for (const field of fields) {
    const [name, ...rest] = field.trim().split('\r\n\r\n');
    result[name.replace(/"/g, '').split(';')[0]] = rest.join('\r\n\r\n');
  }
  return result;
}

/**
 * Sets up before and after hooks to run queryGranulesScrolling with three granules as
 * the response to queryGranulesForScrollId
 */
function hookQueryGranulesScrolling(): void {
  const output = {
    headers: new fetch.Headers({}),
    ...JSON.parse(fs.readFileSync(path.resolve(__dirname, 'resources/atom-granules.json'), 'UTF-8')),
  };

  let fetchPost: sinon.SinonStub;
  before(async function () {
    // Stub cmr fetch post to return the contents of queries
    fetchPost = sinon.stub(cmr, 'fetchPost');
    fetchPost.returns(Promise.resolve(output));

    // Actually call it
    this.result = await queryGranulesScrolling(operation, 'scrollId');

    // Map the call arguments into something we can actually assert against
    this.queryFields = await Promise.all(fetchPost.args.map(fetchPostArgsToFields));
    this.queryFields = this.queryFields.sort((a, b) => a._index - b._index);
  });
  after(function () {
    fetchPost.restore();
    delete this.result;
    delete this.queryFields;
  });
}

/**
 * Sets up before and after hooks to run queryGranules with three granules each in
 * two different collections.
 * @param batchSize - The number of granules to include in each batch
 */
function hookQueryGranules(batchSize: number): void {
  const output = {
    headers: new fetch.Headers({}),
    ...JSON.parse(fs.readFileSync(path.resolve(__dirname, 'resources/atom-granules.json'), 'UTF-8')),
  };
  const queries = [{
    _index: 0,
    fake_param: 'fake_value',
    geojson: 's3://fake-bucket/fake/geo.json',
  }, { _index: 1 }];

  let fetchPost: sinon.SinonStub;
  let downloadFile: sinon.SinonStub;
  let outputDir: string;
  let queryFilenames: string[];
  const pageSize = 5;
  const maxPages = 1;
  before(async function () {
    // Stub access to S3 geojson file
    downloadFile = sinon.stub(S3ObjectStore.prototype, 'downloadFile');
    const shapefile = tmp.tmpNameSync();
    fs.copyFileSync(geojson, shapefile);
    downloadFile.returns(shapefile);

    // Create an output dir
    outputDir = tmp.dirSync({ unsafeCleanup: true }).name;

    // Stub cmr fetch post to return the contents of queries
    fetchPost = sinon.stub(cmr, 'fetchPost');
    queryFilenames = queries.map((q, i) => {
      const filename = tmp.tmpNameSync();
      fs.writeFileSync(filename, JSON.stringify(q));
      fetchPost.onCall(i).returns(Promise.resolve(output));
      return filename;
    });
    fetchPost.onCall(queries.length + 1).throws();

    // Actually call it
    this.result = await queryGranules(operation, queryFilenames, pageSize, maxPages, batchSize);

    // Map the call arguments into something we can actually assert against
    this.queryFields = await Promise.all(fetchPost.args.map(fetchPostArgsToFields));

    this.queryFields = this.queryFields.sort((a, b) => a._index - b._index);
  });
  after(function () {
    queryFilenames.forEach(fs.unlinkSync);
    fetchPost.restore();
    downloadFile.restore();
    fs.rmdirSync(outputDir, { recursive: true });
    delete this.result;
    delete this.queryFields;
  });
}

describe('query#queryGranules', function () {
  describe('when called with a mismatched number of input sources and query files', function () {
    it('throws an error', function () {
      expect(queryGranules(operation, ['fake-tmp.json'], 10, 1, 2000))
        .to.eventually.be.rejectedWith('One query must be provided per input source');
    });
  });

  describe('when called with valid input sources and queries', async function () {
    hookQueryGranules(2000);

    it('returns a STAC catalog containing links to all of the granules', function () {
      expect(this.result[0].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C001-TEST',
        rel: 'harmony_source',
      }, {
        href: './granule_0_0_0000000.json',
        rel: 'item',
        title: '001_00_7f00ff_global',
        type: 'application/json',
      }, {
        href: './granule_0_0_0000001.json',
        rel: 'item',
        title: '001_01_7f00ff_africa',
        type: 'application/json',
      }, {
        href: './granule_0_0_0000002.json',
        rel: 'item',
        title: '001_01_7f00ff_africa_poly',
        type: 'application/json',
      }]);
    });

    it('produces STAC catalogs containing granule links for each input source', function () {
      expect(this.result[1].links[1]).to.eql({
        rel: 'item',
        href: './granule_1_0_0000000.json',
        title: '001_00_7f00ff_global',
        type: 'application/json',
      });
    });

    it('links STAC catalogs to the input source collection', function () {
      expect(this.result[0].links[0]).to.eql({
        rel: 'harmony_source',
        href: `${process.env.CMR_ENDPOINT}/search/concepts/C001-TEST`,
      });
    });

    it('produces STAC items for each granule', function () {
      const item = this.result[0].children[0];
      expect(item).to.eql({
        stac_version: '1.0.0-beta.2',
        stac_extensions: [],
        id: item.id,
        type: 'Feature',
        links: [],
        properties: {
          start_datetime: '2020-01-01T00:00:00.000Z',
          end_datetime: '2020-01-01T01:59:59.000Z',
        },
        bbox: [-180, -90, 180, 90],
        geometry: { type: 'Polygon', coordinates: [[[-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]]] },
        assets: {
          data: {
            href: 'https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_7f00ff_global.nc',
            title: '001_00_7f00ff_global.nc',
            description: undefined,
            type: 'application/x-netcdf4',
            roles: ['data'],
          },
          data1: {
            href: 'https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/tiff/001_00_7f00ff_global.tif',
            title: '001_00_7f00ff_global.tif',
            description: undefined,
            type: 'image/tiff',
            roles: ['data'],
          },
        },
      });
    });

    it('produces valid STAC output for the root catalog', function () {
      const validate = buildStacSchemaValidator('catalog');
      expect(validate(this.result[0].toJSON())).to.equal(true);
    });

    it('produces valid STAC output for the source catalogs', function () {
      const validate = buildStacSchemaValidator('catalog');
      expect(validate(this.result[0].toJSON())).to.equal(true);
    });

    it('produces valid STAC output for the granule items', function () {
      const validate = buildStacSchemaValidator('item');
      expect(validate(this.result[0].children[0])).to.equal(false);
    });

    xit('produces a separate output file for each page of results up to supplied maximum (HARMONY-276)', function () {
      // HARMONY-276 TODO: Implement paging in no granule limit epic with the CMR-6830 scroll API
    });

    it('uses the supplied page size to limit each page of results', function () {
      expect(this.queryFields[0].page_size).to.equal('5');
      expect(this.queryFields[1].page_size).to.equal('5');
    });

    it('uses geojson stored in an S3 location in the query', function () {
      expect(this.queryFields[0].shapefile).to.match(/"FeatureCollection"/);
    });
  });

  describe('when called with a batch size of 1', function () {
    hookQueryGranules(1);

    it('returns multiple STAC catalogs - one for each batch', async function () {
      expect(this.result.length).to.equal(6);
    });

    it('includes a link to the source in each catalog', function () {
      for (let i = 0; i < 3; i++) {
        expect(this.result[i].links[0]).to.eql({
          href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C001-TEST',
          rel: 'harmony_source',
        });
      }
      for (let j = 3; j < 6; j++) {
        expect(this.result[j].links[0]).to.eql({
          href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C002-TEST',
          rel: 'harmony_source',
        });
      }
    });

    it('includes a link to a single granule in each catalog', function () {
      for (const catalog of this.result) {
        expect(catalog.links.length).to.equal(2);
        expect(catalog.links[1].rel).to.equal('item');
      }
    });

    it('produces STAC catalogs for each granule', function () {
      expect(this.result[5].links[1]).to.eql({
        rel: 'item',
        href: './granule_1_2_0000000.json',
        title: '001_01_7f00ff_africa_poly',
        type: 'application/json',
      });
    });

    it('produces STAC items for each granule', function () {
      const item = this.result[0].children[0];
      expect(item).to.eql({
        stac_version: '1.0.0-beta.2',
        stac_extensions: [],
        id: item.id,
        type: 'Feature',
        links: [],
        properties: {
          start_datetime: '2020-01-01T00:00:00.000Z',
          end_datetime: '2020-01-01T01:59:59.000Z',
        },
        bbox: [-180, -90, 180, 90],
        geometry: { type: 'Polygon', coordinates: [[[-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]]] },
        assets: {
          data: {
            href: 'https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_7f00ff_global.nc',
            title: '001_00_7f00ff_global.nc',
            description: undefined,
            type: 'application/x-netcdf4',
            roles: ['data'],
          },
          data1: {
            href: 'https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/tiff/001_00_7f00ff_global.tif',
            title: '001_00_7f00ff_global.tif',
            description: undefined,
            type: 'image/tiff',
            roles: ['data'],
          },
        },
      });
    });

    it('produces valid STAC output for the root catalog', function () {
      const validate = buildStacSchemaValidator('catalog');
      expect(validate(this.result[0].toJSON())).to.equal(true);
    });

    it('produces valid STAC output for the source catalogs', function () {
      const validate = buildStacSchemaValidator('catalog');
      expect(validate(this.result[0].toJSON())).to.equal(true);
    });

    it('produces valid STAC output for the granule items', function () {
      const validate = buildStacSchemaValidator('item');
      expect(validate(this.result[0].children[0])).to.equal(false);
    });
  });
});

describe('query#queryGranulesScrolling', function () {
  describe('when called with valid input sources and queries', async function () {
    hookQueryGranulesScrolling();

    it('returns a STAC catalog for each granule, each with a single item link and STAC item', function () {
      expect(this.result[0].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_scrollId_G1233800343-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_00_7f00ff_global',
        type: 'application/json',
      }]);
      expect(this.result[1].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_scrollId_G1233800344-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_01_7f00ff_africa',
        type: 'application/json',
      }]);
      expect(this.result[2].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_scrollId_G1234866411-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_01_7f00ff_africa_poly',
        type: 'application/json',
      }]);
      expect(this.result.length).to.equal(3);

      for (const catalog of this.result) {
        expect(catalog.links.filter((l) => l.rel === 'item').length).to.equal(1);
      }

      for (const catalog of this.result) {
        expect(catalog.children.length).to.equal(1);
      }
    });

    it('uses a scrolling CMR search', function () {
      expect(this.queryFields[0].scroll).to.equal('true');
    });
    // TODO - uncomment once page size is finalized in cmr.ts#queryGranulesForScrollId
    // it('limits the page size to 2000', function () {
    //   expect(this.queryFields[0].page_size).to.equal('2000');
    // });
  });
});
