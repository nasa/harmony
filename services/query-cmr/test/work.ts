import { expect } from 'chai';
import { describe, it } from 'mocha';

import { defaultObjectStore } from '../../harmony/app/util/object-store';
import { resolve } from '../../harmony/app/util/url';
import { QueryCmrRequest } from '../app/routers/router';
import CmrStacCatalog from '../app/stac/cmr-catalog';
import { hookDoWork } from './helpers/work';

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
        {
          totalItemsSize,
          outputItemSizes: [1],
          stacCatalogs: [new CmrStacCatalog({ description: 'done' })],
        },
      );

      it('outputs the result data to catalog.json in the directory', async function () {
        const catalog = await defaultObjectStore().getObject(resolve(workRequest.outputDir, 'catalog0.json'));
        expect(JSON.parse(catalog).description).to.equal('done');
      });
    });
  });
});

