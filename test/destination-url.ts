import { expect } from 'chai';
import { Context } from 'mocha';
import { Job } from '../app/models/job';
import { hookTransaction } from './helpers/db';
import { hookRedirect } from './helpers/hooks';
import { getObjectText, hookGetBucketRegion, hookUpload } from './helpers/object-store';
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

/**
 * Verify the test result has a 400 status code and an error message that is the same as the given expectedError.
 * 
 * @param context - the test context
 * @param expectedError - the expected error message
 * @throws AssertionError: - if the result status is not 400 or the error messaged is not as expected
 */
function verifyValidationError(context: Context, expectedError: string): void {
  expect(context.res.status).to.equal(400);
  const error = JSON.parse(context.res.text);
  expect(error).to.eql({
    'code': 'harmony.RequestValidationError',
    'description': expectedError,
  });
}

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

    it('the job has harmony-job-status-link file created with the job status link', async function () {
      expect(this.res.status).to.equal(200);
      const jobId = JSON.parse(this.res.text).jobID;
      const s3Url = 's3://dummy/p1/' + jobId + '/harmony-job-status-link';
      const statusLink = await getObjectText(s3Url);
      // this.res.request.url is the job status link
      expect(statusLink).to.equal(this.res.request.url);
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
      verifyValidationError(this, "Error: Invalid destinationUrl 'abcd', must start with s3://");
    });
  });

  describe('when making a request with an invalid destinationUrl with multiple s3 locations', function () {
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://abcd,s3://edfg' } });
    
    it('returns 400 status code for multiple s3 locations which the middleware will concatenate with comma', async function () {
      verifyValidationError(this, "Error: Invalid destinationUrl 's3://abcd,s3://edfg', only one s3 location is allowed.");
    });
  });

  describe('when making a request with an invalid destinationUrl with invalid S3 url', function () {
    hookGetBucketRegion('us-west-2');
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://non-existent-bucket/abcd' } });
    
    it('returns 400 status code for nonexistent s3 bucket', async function () {
      verifyValidationError(this, "Error: The specified bucket 'non-existent-bucket' does not exist.");
    });
  });

  describe('when making a request with an invalid destinationUrl with no s3 bucket', function () {
    hookGetBucketRegion('us-west-2');
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://' } });
    
    it('returns 400 status code for no s3 bucket', async function () {
      verifyValidationError(this, 'Error: Invalid destinationUrl, no s3 bucket is provided.');
    });
  });

  describe('when making a request with an invalid destinationUrl with invalid bucket name', function () {
    hookGetBucketRegion('us-west-2');
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://invalid,bucket' } });
    
    it('returns 400 status code for invalid bucket name', async function () {
      verifyValidationError(this, "Error: The specified bucket 'invalid,bucket' is not valid.");
    });
  });

  describe('when making a request without permission to check bucket location', function () {
    hookGetBucketRegion('us-west-2');
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://no-permission' } });
    
    it('returns 400 status code when no permission to get bucket location', async function () {
      verifyValidationError(this, "Error: Do not have permission to get bucket location of the specified bucket 'no-permission'.");
    });
  });

  describe('when making a request to s3 url that is not writable', function () {
    hookGetBucketRegion('us-west-2');
    hookUpload();
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://no-write-permission' } });
    
    it('returns 400 status code when not writable', async function () {
      verifyValidationError(this, "Error: Do not have write permission to the specified s3 location: 's3://no-write-permission'.");
    });
  });

  describe('when making a request with an invalid destinationUrl with bucket in a different region', function () {
    hookGetBucketRegion('us-east-1');
    StubService.hook({ params: { status: 'successful' } });
    hookRangesetRequest('1.0.0', collection, 'all', { query: { destinationUrl: 's3://abcd/p1' } });

    it('returns 400 status code for bucket in different region', async function () {
      verifyValidationError(this, "Error: Destination bucket 'abcd' must be in the 'us-west-2' region, but was in 'us-east-1'.");
    });
  });
});
