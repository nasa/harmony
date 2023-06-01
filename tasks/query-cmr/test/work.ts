import { QueryCmrRequest } from './../app/routers/router';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { hookDoWork } from './helpers/work';
import CmrStacCatalog from '../app/stac/cmr-catalog';
import { resolve } from '../../../app/util/url';
import { defaultObjectStore } from '../../../app/util/object-store';

describe('doWork', function () {
  describe('main', function () {
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
        const catalog = await defaultObjectStore().getObject(resolve(workRequest.outputDir, 'catalog0.json'));
        expect(JSON.parse(catalog).description).to.equal('done');
      });
    });
  });
});

