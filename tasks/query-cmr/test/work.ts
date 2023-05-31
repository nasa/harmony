import { QueryCmrRequest } from './../app/routers/router';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { hookDoWork } from './helpers/work';
import CmrStacCatalog from '../app/stac/cmr-catalog';
import { resolve } from '../../../app/util/url';
import { FileStore } from '../../../app/util/object-store/file-store';
import * as objStore from '../../../app/util/object-store';
import * as sinon from 'sinon';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
// import * as objStore from '../../../test/helpers/object-store';

describe('doWork', function () {
  describe('main', function () {

    before(async function () {
      // Stub cmr fetch post to return the contents of queries

      // Stub object-store calls to store/get query params
      this.store = new FileStore();
      // this.uploadStub = sinon.stub(this.store, 'upload');
      // this.downloadStub = sinon.stub(this.store, 'getObject').returns(Promise.resolve('{"collection_concept_id": "C001-TEST"}'));
      this.defaultStoreStub = sinon.stub(objStore, 'defaultObjectStore').returns(this.store);
      this.protocolStub = sinon.stub(objStore, 'objectStoreForProtocol').returns(this.store);
    });
    after(function () {
      this.defaultStoreStub.restore();
      // this.uploadStub.restore();
      // this.downloadStub.restore();
      this.protocolStub.restore();
      delete this.store;
    });
    describe('when the output directory exists', function () {
      const totalItemsSize = 1.0;
      const workRequest: QueryCmrRequest = {
        workItemId: 0,
        outputDir: 's3://stac/abc/123/outputs/',
      };
      hookDoWork(
        workRequest,
        [totalItemsSize, [1], [new CmrStacCatalog({ description: 'done' })]],
      );

      it('outputs the result data to catalog.json in the directory', async function () {
        const catalog = await this.store.getObject(resolve(workRequest.outputDir, 'catalog0.json'));
        // console.log(`Catalog is ${catalog}`);
        expect(JSON.parse(catalog).description).to.equal('done');
      });
    });
  });
});

