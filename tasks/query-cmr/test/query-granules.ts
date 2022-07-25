/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable  node/no-unpublished-require */
import fs from 'fs';
import path from 'path';
import chai, { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import * as fetch from 'node-fetch';
import { Stream } from 'form-data';
import { queryGranules } from '../app/query';

import * as cmr from '../../../app/util/cmr';
import DataOperation from '../../../app/models/data-operation';
import { S3ObjectStore } from '@harmony/util/object-store';
import { stub } from 'sinon';

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
 * @param maxCmrGranules - limit the number of granules returned in the CMR page
 */
function hookQueryGranules(maxCmrGranules?: number): void {
  const output = {
    headers: new fetch.Headers({}),
    ...JSON.parse(fs.readFileSync(path.resolve(__dirname, 'resources/atom-granules.json'), 'utf8')),
  };

  let fetchPost: sinon.SinonStub;
  before(async function () {
    // Stub cmr fetch post to return the contents of queries
    fetchPost = sinon.stub(cmr, 'fetchPost');
    fetchPost.returns(Promise.resolve(output));

    // Stub objectstore calls to store/get query params
    const store = new S3ObjectStore();
    const headObjectResponse = { Metadata: { foo: 'bar' }, ContentType: 'image/png' };
    // this.headObjectStub = stub(store.s3, 'headObject').returns({ promise: () => headObjectResponse } as unknown as Request<HeadObjectOutput, AWSError>);
    this.uploadFileStub = stub(store, 'uploadFile').returns('s3://local-staging-bucket/SearchParams/ABC123/serializedQuery')
    this.getObjectStub = stub(store.s3, 'getObject').returns({ presign: () => 'http://example.com/signed' } as unknown as Request<GetObjectOutput, AWSError>);

    // Actually call it
    this.result = await queryGranules(operation, 'scrollId', maxCmrGranules);

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

describe('query#queryGranulesScrolling', function () {
  describe('when called with valid input sources and queries', async function () {
    hookQueryGranules();

    it('returns the combined granules sizes', function () {
      expect(this.result[0]).to.be.greaterThan(0);
    });

    it('returns a STAC catalog for each granule, each with a single item link and STAC item', function () {
      expect(this.result[1][0].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_scrollId_G1233800343-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_00_7f00ff_global',
        type: 'application/json',
      }]);
      expect(this.result[1][1].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_scrollId_G1233800344-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_01_7f00ff_africa',
        type: 'application/json',
      }]);
      expect(this.result[1][2].links).to.eql([{
        href: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1233800302-EEDTEST',
        rel: 'harmony_source',
      }, {
        href: './granule_scrollId_G1234866411-EEDTEST_0000000.json',
        rel: 'item',
        title: '001_01_7f00ff_africa_poly',
        type: 'application/json',
      }]);
      expect(this.result[1].length).to.equal(3);

      for (const catalog of this.result[1]) {
        expect(catalog.links.filter((l) => l.rel === 'item').length).to.equal(1);
      }

      for (const catalog of this.result[1]) {
        expect(catalog.children.length).to.equal(1);
      }
    });

    it('uses a scrolling CMR search', function () {
      expect(this.queryFields[0].scroll).to.equal('true');
    });
    it('does not use the page_size parameter', function () {
      expect(this.queryFields[0].page_size).to.equal(undefined);
    });
  });

  describe('when called with a max CMR granules limit', async function () {
    hookQueryGranules(1);

    it('limits the STAC output', function () {
      expect(this.result[1].length).to.equal(1);
    });
  });

  describe('when called with a max CMR granules limit that exceeds the number of CMR granules', async function () {
    hookQueryGranules(3000);

    it('the STAC output is not limited', function () {
      expect(this.result[1].length).to.equal(3);
    });
  });
});
