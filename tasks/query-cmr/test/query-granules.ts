import fs from 'fs';
import { expect } from 'chai';
import { describe, it, xit } from 'mocha';
import * as sinon from 'sinon';
import tmp from 'tmp';
import * as fetch from 'node-fetch';
import { Stream } from 'form-data';
import { queryGranules } from '../app/query';

import * as cmr from '../../../app/util/cmr';
import DataOperation from '../../../app/models/data-operation';
import { S3ObjectStore } from '../../../app/util/object-store';

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
 * @param formdata the formdata stream
 * @returns
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
 * @param _ (Ignored path argument)
 * @param formdata form data being posted to CMR
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

describe('query#queryGranules', function () {
  describe('when called with a mismatched number of input sources and query files', function () {
    it('throws an error', function () {
      expect(queryGranules(operation, ['fake-tmp.json'], '/fake-tmp', 10, 1))
        .to.eventually.be.rejectedWith('One query must be provided per input source');
    });
  });

  describe('when called with valid input sources and queries', function () {
    const queries = [
      {
        input: {
          _index: 0,
          fake_param: 'fake_value',
          geojson: 's3://fake-bucket/fake/geo.json',
        },
        output: {
          data: {
            feed: {
              entry: [{ // TODO: HARMONY-554 to handle serialization in depth.  This is minimal
                id: 'G001-TEST',
                title: 'First granule',
                boxes: ['-180 -90 180 90'],
                links: [{
                  rel: '/data#',
                  href: 'http://example.com',
                }],
                time_start: '2020-01-01T00:00:00.000Z',
                time_end: '2020-01-01T00:00:00.000Z',
              }],
            },
          },
          headers: new fetch.Headers({}),
        },
        expectation: [{
          collection: 'C001-TEST',
          granules: [{
            id: 'G001-TEST',
            name: 'First granule',
            urls: ['http://example.com'],
            bbox: [-90, -180, 90, 180],
            temporal: { start: '2020-01-01T00:00:00.000Z', end: '2020-01-01T00:00:00.000Z' },
          }],
        }],
      },
      {
        input: {
          _index: 1,
          fake_param: 'fake_value',
        },
        output: {
          data: {
            feed: {
              entry: [

              ],
            },
          },
          headers: new fetch.Headers({}),
        },
        expectation: [{
          collection: 'C002-TEST',
          granules: [],
        }],
      },
    ];
    let fetchPost: sinon.SinonStub;
    let downloadFile: sinon.SinonStub;
    let outputDir: string;
    let queryFilenames: string[];
    const pageSize = 5;
    const maxPages = 1;
    let queryFields;
    let result;
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
        fs.writeFileSync(filename, JSON.stringify(q.input));
        fetchPost.onCall(i).returns(Promise.resolve(q.output));
        return filename;
      });
      fetchPost.onCall(queries.length).throws();

      // Actually call it
      result = await queryGranules(operation, queryFilenames, outputDir, pageSize, maxPages);
      result = result.sort();

      // Map the call arguments into something we can actually assert against
      queryFields = await Promise.all(fetchPost.args.map(fetchPostArgsToFields));
      queryFields = queryFields.sort((a, b) => a._index - b._index);
    });
    after(function () {
      queryFilenames.forEach(fs.unlinkSync);
      fetchPost.restore();
      downloadFile.restore();
      fs.rmdirSync(outputDir, { recursive: true });
    });

    it('returns a list of output files produced', function () {
      for (let i = 0; i < queries.length; i++) {
        const fileContents = fs.readFileSync(result[i]).toString('utf-8');
        const expectation = JSON.stringify(queries[i].expectation);
        expect(fileContents).to.equal(expectation);
      }
    });

    it('produces separate output files for each input source', function () {
      expect(result.length).to.equal(2);
    });

    xit('produces a separate output file for each page of results up to supplied maximum (HARMONY-276)', function () {
      // HARMONY-276 TODO: Implement paging in no granule limit epic with the CMR-6830 scroll API
    });

    it('uses the supplied page size to limit each page of results', function () {
      expect(queryFields[0].page_size).to.equal('5');
      expect(queryFields[1].page_size).to.equal('5');
    });

    it('uses geojson stored in an S3 location in the query', function () {
      expect(queryFields[0].shapefile).to.match(/"FeatureCollection"/);
    });
  });
});
