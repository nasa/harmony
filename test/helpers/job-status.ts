import { it } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { Job } from 'models/job';
import { hookRedirect, hookUrl } from './hooks';
import { hookRangesetRequest } from './ogc-api-coverages';
import StubService from './stub-service';
import env from '../../app/util/env';
import { S3ObjectStore } from '../../app/util/object-store';

/**
 * Provides `it` statements asserting that the provided paging relations are available in `this.res`
 * and have the correct link values relative to the supplied current page.  If a page number is set
 * to null, asserts that the relation is not present.
 * @param pageCount - the total number of pages available
 * @param relations - a map of link relations to their expected page numbers
 * @param limit - the number of items on each page (default = 10)
 */
// export default function itIncludesPagingRelations(
//   pageCount: number,
//   relations: PagingRelationInfo,
//   limit = 10,
// ): void {
//   for (const rel of Object.keys(relations)) {
//     const expectedPage = relations[rel];
//     if (expectedPage === null || expectedPage === undefined) {
//       it(`does not provide a "${rel}" link relation`, function () {
//         const listing = JSON.parse(this.res.text);
//         const actual = listing.links.find((link) => link.rel === rel);
//         expect(actual).to.not.exist;
//       });
//     } else {
//       it(`provides a "${rel}" link relation with correctly set page and limit parameters`, function () {
//         const listing = JSON.parse(this.res.text);
//         const actual = listing.links.find((link) => link.rel === rel);
//         expect(actual).to.exist;
//         expect(actual.href).to.include(`/jobs?page=${expectedPage}&limit=${limit}`);
//         expect(actual.title).to.include(`(${expectedPage} of ${pageCount})`);
//       });
//     }
//   }
// }

/**
 * Provides a parameterized `describe` blocks that tests expected format of data links.
 * @param version - the harmony API version
 * @param collection - the id of the collection for the request
 * @param variableName - the name of the variable in the collection to process
 *
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
    const urlRegex = new RegExp(`^s3://${env.stagingBucket}/public/harmony/stub/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/$`);
    expect(bucketLinks[0].href).to.match(urlRegex);
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
export function testHttpDataLinks(user: string): void {
  it('provides a permanent link to a Harmony HTTP URL', function () {
    const job = new Job(JSON.parse(this.res.text));
    const jobOutputLinks = job.getRelatedLinks('data');
    expect(jobOutputLinks[0].href).to.match(/^http/);
    expect(jobOutputLinks[0].href).to.have.string('/service-results/example-bucket/public/example/path.tif');
  });

  describe('loading the provided Harmony HTTP URL', function () {
    before(function () {
      sinon.stub(S3ObjectStore.prototype, 'signGetObject')
        .callsFake(async (url, params) => `https://example.com/signed/${params['A-userid']}`);
    });
    after(function () {
      (S3ObjectStore.prototype.signGetObject as sinon.SinonStub).restore();
    });

    hookUrl(function () {
      const job = new Job(JSON.parse(this.res.text));
      return job.getRelatedLinks('data')[0].href.split(/:\d+/)[1];
    }, user);

    it('temporarily redirects to a presigned URL for the data', function () {
      expect(this.res.statusCode).to.equal(307);
      expect(this.res.headers.location).to.equal('https://example.com/signed/jdoe1');
    });
  });
}
