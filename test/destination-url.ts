import { expect } from 'chai';
import { Job } from '../app/models/job';
import { hookTransaction } from './helpers/db';
import { hookRedirect } from './helpers/hooks';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';

const reprojectAndZarrQuery = {
  maxResults: 1,
  outputCrs: 'EPSG:4326',
  interpolation: 'near',
  scaleExtent: '0,2500000.3,1500000,3300000',
  scaleSize: '1.1,2',
  format: 'application/x-zarr',
  ignoreErrors: true,
  concatenate: false,
  destinationUrl: 's3://dummy',
};

describe('when setting destinationUrl on ogc request', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();

  describe('when making a request with a valid destinationUrl', function () {
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery } });
    hookRedirect('anonymous');
    hookTransaction();

    it('returns 200 status code for the job', async function () {
      expect(this.res.status).to.equal(200);
    });

    it('sets the destination_url on the job in db', async function () {
      const retrieved = await Job.forUser(this.trx, 'anonymous');
      expect(retrieved.data[0].destination_url).to.eq('s3://dummy');
    });
  });
});
