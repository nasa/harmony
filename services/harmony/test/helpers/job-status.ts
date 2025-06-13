import { expect } from 'chai';
import { it } from 'mocha';
import sinon from 'sinon';

import { EXPIRATION_DAYS, Job } from '../../app/models/job';
import env from '../../app/util/env';
import { jobStatusCache } from '../../app/util/job';
import { hookUrl } from './hooks';

/**
 * Hooks the job status cache for tests to not use the cache
 */
export function hookJobStatusCache(): void {
  let jobStatusCacheStub;
  before(() => {
    jobStatusCacheStub = sinon.stub(jobStatusCache, 'get').returns(undefined);
  });

  after(function () {
    if (jobStatusCacheStub.restore) {
      jobStatusCacheStub.restore();
    }
  });
}

const timeStampRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

/**
 * Defines test for presence of dataExpiration field
 */
export function itIncludesADataExpirationField(): void {
  it('provides the date when the data will expire', function () {
    const job = JSON.parse(this.res.text);
    expect(job.dataExpiration).to.match(timeStampRegex);
    const expiration = new Date(job.dataExpiration);
    const expectedExpiration = new Date(job.createdAt);
    expectedExpiration.setUTCDate(expectedExpiration.getUTCDate() + EXPIRATION_DAYS);
    expect(expiration).eql(expectedExpiration);
  });
}


/**
 * Provides a parameterized `describe` blocks that tests expected format of data links.
 *
 * @param s3Uri - the S3 URI
 * @param serviceName - the name of the service used - defaults to harmony/example
 */
export function itReturnsUnchangedDataLinksForZarr(
  s3Uri: string,
): void {
  it('returns the S3 URL', function () {
    const job = new Job(JSON.parse(this.res.text));
    const jobOutputLinks = job.getRelatedLinks('data');
    expect(jobOutputLinks[0].href).to.equal(s3Uri);
  });

  it('includes a link to the staging bucket', function () {
    const job = new Job(JSON.parse(this.res.text));
    const bucketLinks = job.getRelatedLinks('s3-access');
    expect(bucketLinks.length).to.equal(1);
    const matchingLocation = new RegExp(`^.*${env.stagingBucket}public/${job.jobID}/`);
    expect(bucketLinks[0].href).to.match(matchingLocation);
    expect(bucketLinks[0].title).to.equal('Results in AWS S3. Access from AWS us-west-2 with keys from /cloud-access.sh');
  });

  it('includes a link to the /cloud-access json endpoint', function () {
    const job = new Job(JSON.parse(this.res.text));
    const cloudAccessJsonLinks = job.getRelatedLinks('cloud-access-json');
    expect(cloudAccessJsonLinks.length).to.equal(1);
    expect(cloudAccessJsonLinks[0].href).to.match(/^http.*\/cloud-access$/);
    expect(cloudAccessJsonLinks[0].title).to.equal('Access keys for s3:// URLs, usable from AWS us-west-2 (JSON format)');
    expect(cloudAccessJsonLinks[0].type).to.equal('application/json');
  });

  it('includes a link to the /cloud-access.sh endpoint', function () {
    const job = new Job(JSON.parse(this.res.text));
    const cloudAccessShLinks = job.getRelatedLinks('cloud-access-sh');
    expect(cloudAccessShLinks.length).to.equal(1);
    expect(cloudAccessShLinks[0].href).to.match(/^http.*\/cloud-access.sh$/);
    expect(cloudAccessShLinks[0].title).to.equal('Access keys for s3:// URLs, usable from AWS us-west-2 (Shell format)');
    expect(cloudAccessShLinks[0].type).to.equal('application/x-sh');
  });

  it('includes instructions in the message on how to access the S3 links', function () {
    const job = new Job(JSON.parse(this.res.text));
    expect(job.message).to.contain('Contains results in AWS S3. Access from AWS us-west-2 with keys from');
  });
}

/**
 * Common tests for HTTP data links generated from s3 links provided by services
 *
 * @param user - the user id that created the job for which status is being tested
 */
export function itProvidesAWorkingHttpUrl(user: string): void {
  it('provides a permanent link to a Harmony HTTP URL', function () {
    const job = new Job(JSON.parse(this.res.text));
    const jobOutputLinks = job.getRelatedLinks('data');
    expect(jobOutputLinks[0].href).to.match(/^http/);
    expect(jobOutputLinks[0].href).to.have.string('/service-results/example-bucket/public/example-job-id/work-item-id/path.tif');
  });

  describe('loading the provided Harmony HTTP URL', function () {
    hookUrl(function () {
      const job = new Job(JSON.parse(this.res.text));
      return job.getRelatedLinks('data')[0].href.split(/:\d+/)[1];
    }, user);

    it('temporarily redirects to a presigned URL for the data', function () {
      expect(this.res.statusCode).to.equal(307);
      expect(this.res.headers.location).to.have.string('https://example-bucket/public/example-job-id/work-item-id/path.tif');
    });
  });
}