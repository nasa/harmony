/* eslint-disable @typescript-eslint/no-var-requires */
import chai, { expect } from 'chai';
import { Stream } from 'form-data';
/* eslint-disable node/no-unpublished-require */
import fs from 'fs';
import { describe, it } from 'mocha';
import * as fetch from 'node-fetch';
import path from 'path';
import * as sinon from 'sinon';

import DataOperation from '../../harmony/app/models/data-operation';
import * as cmr from '../../harmony/app/util/cmr';
import { CmrError } from '../../harmony/app/util/errors';
import logger from '../../harmony/app/util/log';
import { FileStore } from '../../harmony/app/util/object-store/file-store';
import { queryGranules } from '../app/query';

chai.use(require('chai-as-promised'));

const operation = new DataOperation({
  requestId: 'aaaaaaaa-bbbb-1234-cccc-dddddddddddd',
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
  [_a, _b, formdata],
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const data = (await formDataToString(formdata)).replace(/-+[a-f0-9]+-*\r\n/g, '');
  const result = {};
  const fields = data.split(/Content-Disposition: form-data; name=/g).slice(1);
  for (const field of fields) {
    const [name, ...rest] = field.trim().split('\r\n\r\n');
    result[name.replace(/"/g, '').split(';')[0]] = rest.join('\r\n\r\n');
  }
  return result;
}

/**
 * Sets up before and after hooks to run queryGranules with three granules as
 * the response to queryGranulesWithSearchAfter
 * @param maxCmrGranules - limit the number of granules returned in the CMR page
 */
function hookQueryGranules(maxCmrGranules = 100): void {
  const output = {
    headers: new fetch.Headers({}),
    ...JSON.parse(fs.readFileSync(path.resolve(__dirname, 'resources/umm-granules.json'), 'utf8')),
  };

  let fetchPost: sinon.SinonStub;
  before(async function () {
    // Stub cmr fetch post to return the contents of queries
    fetchPost = sinon.stub(cmr, 'fetchPost');
    fetchPost.returns(Promise.resolve(output));
    this.downloadStub = sinon.stub(FileStore.prototype, 'getObject').returns(Promise.resolve('{"collection_concept_id": "C001-TEST"}'));

    // Actually call it
    this.result = await queryGranules(operation, 'scrollId', maxCmrGranules, logger);

    // Map the call arguments into something we can actually assert against
    this.queryFields = await Promise.all(fetchPost.args.map(fetchPostArgsToFields));
    this.queryFields = this.queryFields.sort((a, b) => a._index - b._index);
  });
  after(function () {
    this.downloadStub.restore();

    fetchPost.restore();
    delete this.result;
    delete this.queryFields;
  });
}

/**
 * Sets up before and after hooks to run queryGranules with an error response from the CMR
 */
function hookQueryGranulesWithError(): void {
  const output = {
    headers: new fetch.Headers({}),
    ...{
      status: 404,
      data: {
        errors: [
          'Failed to query CMR',
        ],
      },
    },
  };

  let fetchPost: sinon.SinonStub;
  before(async function () {
    // Stub cmr fetchPost to return the contents of queries
    fetchPost = sinon.stub(cmr, 'fetchPost');
    fetchPost.returns(Promise.resolve(output));
  });
  after(function () {
    fetchPost.restore();
  });
}

describe('query#queryGranules', function () {
  describe('when called with valid input sources and queries', async function () {
    hookQueryGranules();

    it('returns the combined granules sizes', function () {
      expect(this.result.totalItemsSize).to.be.greaterThan(0);
    });

    it('returns the size for each granule', function () {
      expect(this.result.outputItemSizes).to.eql([1436745, 311623, 311623]);
    });

    it('returns a STAC catalog for each granule, each with a single item link and STAC item', function () {
      expect(this.result.stacCatalogs[0].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_G1233800343-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_00_7f00ff_global',
        type: 'application/json',
      }]);
      expect(this.result.stacCatalogs[1].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_G1233800344-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_01_7f00ff_africa',
        type: 'application/json',
      }]);
      expect(this.result.stacCatalogs[2].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_G1234866411-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_01_7f00ff_africa_poly',
        type: 'application/json',
      }]);
      expect(this.result.stacCatalogs.length).to.equal(3);

      for (const catalog of this.result.stacCatalogs) {
        expect(catalog.links.filter((l) => l.rel === 'item').length).to.equal(1);
      }

      for (const catalog of this.result.stacCatalogs) {
        expect(catalog.children.length).to.equal(1);
      }
    });

    it('does not use a scrolling CMR search', function () {
      expect(this.queryFields[0].scroll).to.equal(undefined);
    });
    it('uses the page_size parameter', function () {
      expect(this.queryFields[0].page_size).to.equal('100');
    });
  });

  describe('when called with a max CMR granules limit', async function () {
    hookQueryGranules(1);

    it('sets the page_size parameter to the limit', function () {
      expect(this.queryFields[0].page_size).to.equal('1');
    });
  });

  describe('when called with a max CMR granules limit that exceeds the number of CMR granules', async function () {
    hookQueryGranules(3000);

    it('the STAC output is not limited', function () {
      expect(this.result.stacCatalogs.length).to.equal(3);
    });
  });

  describe('when the CMR returns an error', async function () {
    hookQueryGranulesWithError();

    it('throws an error containing the CMR error message', async function () {
      await expect(queryGranules(operation, null, 1, logger)).to.be.rejectedWith(CmrError, 'Failed to query CMR');
    });

  });
});
