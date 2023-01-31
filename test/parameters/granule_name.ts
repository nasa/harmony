import { expect } from 'chai';
import { hookTransaction } from '../helpers/db';
import { hookRedirect } from '../helpers/hooks';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';

const regularQuery = {
  format: 'application/x-zarr',
  granuleName: '001_08_7f00ff_oceania_east',
};

const wildCardQuery = {
  format: 'application/x-zarr',
  granuleName: '001_*',
};

describe('when passing the granuleName parameter', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();

  describe('when making a request with a valid granuleName without wildcards', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...regularQuery } });
    hookRedirect('anonymous');
    hookTransaction();

    it('returns a 200 status code for the request', async function () {
      expect(this.res.status).to.equal(200);
    });

    it('processes a single matching granule', async function () {
      expect(this.res.body.numInputGranules).to.equal(1);
    });
  });

  // wildcards are tested more thoroughly in the cmr tests - this is just to make sure it
  // works with more than one result
  describe('when making a request with a valid granuleName with wildcards', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...wildCardQuery } });
    hookRedirect('anonymous');
    hookTransaction();

    it('returns a 200 status code for the request', async function () {
      expect(this.res.status).to.equal(200);
    });

    it('processes all the matching granules', async function () {
      expect(this.res.body.numInputGranules).to.equal(12);
    });
  });
});
