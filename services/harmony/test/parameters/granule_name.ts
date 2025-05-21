import { expect } from 'chai';
import { hookTransaction } from '../helpers/db';
import { hookRedirect } from '../helpers/hooks';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';

describe('when passing the granuleName parameter', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();

  describe('when making a request with a valid granuleName without wildcards', function () {
    const regularQuery = {
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      height: 500,
      width: 1000,
      granuleName: '001_08_7f00ff_oceania_east',
    };

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
    const wildCardQuery = {
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      height: 500,
      width: 1000,
      granuleName: '001_*',
    };

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

  describe('when making a request with multiple valid granuleName values', function () {
    const multiValueQuery = {
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      height: 500,
      width: 1000,
      granuleName: ['001_08_7f00ff_oceania_east', '001_03_7f00ff_asia_east'],
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...multiValueQuery } });
    hookRedirect('anonymous');
    hookTransaction();

    it('returns a 200 status code for the request', async function () {
      expect(this.res.status).to.equal(200);
    });

    it('processes all the matching granules', async function () {
      expect(this.res.body.numInputGranules).to.equal(2);
    });
  });
});
