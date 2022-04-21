/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable  node/no-unpublished-require */
import fs from 'fs';
import path from 'path';
import chai, { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import * as fetch from 'node-fetch';
import { Stream } from 'form-data';
import { queryGranulesScrolling } from '../app/query';

import * as cmr from '../../../app/util/cmr';
import DataOperation from '../../../app/models/data-operation';
import { CmrError } from '../../../app/util/errors';

chai.use(require('chai-as-promised'));

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
    ...JSON.parse(fs.readFileSync(path.resolve(__dirname, 'resources/atom-granules.json'), 'utf8')),
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
 * Sets up before and after hooks to run queryGranulesScrolling with an error response from the CMR
 */
function hookQueryGranulesScrollingWithError(): void {
  const output = {
    headers: new fetch.Headers({}),
    ...{
      status: 404,
      data: {
        errors: [
          'Scroll session [1234] does not exist',
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
    delete this.result;
    delete this.queryFields;
  });
}

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
    it('limits the page size to 2000', function () {
      expect(this.queryFields[0].page_size).to.equal('2000');
    });
  });

  describe('when the CMR returns an error', async function () {
    hookQueryGranulesScrollingWithError();

    it('throws an error containing the CMR error message', async function () {
      await expect(queryGranulesScrolling(operation, 'scrollId')).to.be.rejectedWith(CmrError, 'Scroll session [1234] does not exist');
    });

  });
});
