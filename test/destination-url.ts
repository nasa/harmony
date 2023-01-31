import { expect } from 'chai';
import { Job } from '../app/models/job';
import { hookTransaction } from './helpers/db';
import { hookRedirect } from './helpers/hooks';
import { hookGetBucketRegion } from './helpers/object-store';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import StubService from './helpers/stub-service';

const reprojectAndZarrQuery = {
  maxResults: 1,
  outputCrs: 'EPSG:4326',
  interpolation: 'near',
  scaleExtent: '0,2500000.3,1500000,3300000',
  scaleSize: '1.1,2',
  format: 'application/x-zarr',
  ignoreErrors: true,
  concatenate: false,
  destinationUrl: 's3://dummy/p1',
};

describe('when setting destinationUrl on ogc request', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();
  
  describe('when making a request with a valid destinationUrl', function () {
    hookGetBucketRegion('us-west-2');
    hookRangesetRequest('1.0.0', collection, 'all', { query: { ...reprojectAndZarrQuery } });
    hookRedirect('anonymous');
    hookTransaction();

    it('returns 200 status code for the job', async function () {
      expect(this.res.status).to.equal(200);
    });

    it('sets the destination_url on the job in db', async function () {
      const retrieved = await Job.forUser(this.trx, 'anonymous');
      expect(retrieved.data[0].destination_url).to.eq('s3://dummy/p1');
    });
  });

  describe('when making a request with an invalid destinationUrl with invalid S3 url format', function () {
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 'abcd' } });
    
    it('returns 400 status code for invalid s3 url format', async function () {
      expect(this.res.status).to.equal(400);
      const error = JSON.parse(this.res.text);
      expect(error).to.eql({
        'code': 'harmony.RequestValidationError',
        'description': "Error: Invalid destinationUrl 'abcd' must start with s3://",
      });
    });
  });

  describe('when making a request with an invalid destinationUrl with invalid S3 url', function () {
    hookGetBucketRegion('us-west-2');
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://non-existent-bucket/abcd' } });
    
    it('returns 400 status code for nonexistent s3 bucket', async function () {
      expect(this.res.status).to.equal(400);
      const error = JSON.parse(this.res.text);
      expect(error).to.eql({
        'code': 'harmony.RequestValidationError',
        'description': "Error: The specified bucket 'non-existent-bucket' does not exist.",
      });
    });
  });

  describe('when making a request with an invalid destinationUrl with bucket in a different region', function () {
    hookGetBucketRegion('us-east-1');
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://abcd/p1' } });

    it('returns 400 status code for bucket in different region', async function () {
      expect(this.res.status).to.equal(400);
      const error = JSON.parse(this.res.text);
      expect(error).to.eql({
        'code': 'harmony.RequestValidationError',
        'description': "Error: Destination bucket 'abcd' must be in the 'us-west-2' region, but was in 'us-east-1'.",
      });
    });
  });
});
