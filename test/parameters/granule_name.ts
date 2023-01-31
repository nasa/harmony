import { expect } from 'chai';
import { Job } from '../../app/models/job';
import { hookTransaction } from '../helpers/db';
import { hookRedirect } from '../helpers/hooks';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';

const reprojectAndZarrQuery = {
  maxResults: 1,
  format: 'application/x-zarr',
  granuleName: '001_08_7f00ff_oceania_east',
};

describe('when passing the granuleName parameter', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();

  describe('when making a request with a valid granuleName', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery } });
    hookRedirect('anonymous');
    hookTransaction();


    it('returns a 200 status code for the request', async function () {
      expect(this.res.status).to.equal(200);
    });

    // it('sets the destination_url on the job in db', async function () {
    //   const retrieved = await Job.forUser(this.trx, 'anonymous');
    //   expect(retrieved.data[0].destination_url).to.eq('s3://dummy');
    // });
  });
});
