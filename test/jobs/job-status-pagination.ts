import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { Job } from '../../app/models/job';
import JobLink from '../../app/models/job-link';
import hookServersStartStop from '../helpers/servers';
import { hookJobStatus, buildJob, areJobLinksEqual, itIncludesPagingRelations } from '../helpers/jobs';
import db from '../../app/util/db';
import env from '../../app/util/env';

describe('Individual job status route - pagination', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  const links: JobLink[] = [] as JobLink[];
  const aJob = buildJob({ username: 'joe', links });
  let defaultResultPageSize;

  before(async function () {
    // use a DEFAULT_RESULT_PAGE size of 10 for these tests
    ({ defaultResultPageSize } = env);
    env.defaultResultPageSize = 10;

    // Generate some links for the job - need to save the job after each link is added to
    // circumvent ordering problems with sqlite
    const jTrx = await db.transaction();
    await aJob.save(jTrx);
    await jTrx.commit();
    for (let i = 1; i < 51; i++) {
      links.push(
        new JobLink({
          href: `http://example.com/${i}`,
          title: `Example ${i}`,
          type: i % 2 === 0 ? 'text/plain' : 'text/ornate',
          rel: 'data',
        }),
      );
    }

    for (const link of links) {
      const trx = await db.transaction();
      aJob.addLink(
        link,
      );
      await aJob.save(trx);
      await trx.commit();
    }
  });

  after(function () {
    env.defaultResultPageSize = defaultResultPageSize;
  });

  const jobID = aJob.requestId;
  describe('when `page` parameter is set', function () {
    describe('and the page is a valid page', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 2 } });
      it('shows the corresponding page of results', function () {
        const job = new Job(JSON.parse(this.res.text));
        const outputLinks = job.getRelatedLinks('data');
        expect(areJobLinksEqual(links.slice(10, 20), outputLinks)).to.equal(true);
      });
    });

    describe('and the page is a not a valid page', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 0 } });
      it('returns a 400 HTTP Bad request response', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Parameter "page" is invalid. Must be an integer greater than or equal to 1.',
        });
      });
    });

    describe('and the page is not an integer', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 1.5 } });
      it('returns a 400 HTTP Bad request response', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Parameter "page" is invalid. Must be an integer greater than or equal to 1.',
        });
      });
    });
  });

  describe('when `page` parameter and `limit` are not set', function () {
    hookJobStatus({ jobID, username: 'joe', query: {} });
    it('shows the first page of results with the default page size', function () {
      const job = new Job(JSON.parse(this.res.text));
      const outputLinks = job.getRelatedLinks('data');
      expect(areJobLinksEqual(links.slice(0, 10), outputLinks)).to.equal(true);
    });
  });

  describe('when `limit` parameter is set', function () {
    describe('and the limit is valid', function () {
      hookJobStatus({ jobID, username: 'joe', query: { limit: 2 } });
      it('shows the corresponding page of results', function () {
        const job = new Job(JSON.parse(this.res.text));
        const outputLinks = job.getRelatedLinks('data');
        expect(areJobLinksEqual(links.slice(0, 2), outputLinks)).to.equal(true);
      });
    });

    describe('and the limit is invalid', function () {
      hookJobStatus({ jobID, username: 'joe', query: { limit: 10001 } });
      it('returns a 400 HTTP Bad request response', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Parameter "limit" is invalid. Must be an integer greater than or equal to 0 and less than or equal to 2000.',
        });
      });
    });

    describe('and the limit is not an integer', function () {
      hookJobStatus({ jobID, username: 'joe', query: { limit: 2000.5 } });
      it('returns a 400 HTTP Bad request response', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Parameter "limit" is invalid. Must be an integer greater than or equal to 0 and less than or equal to 2000.',
        });
      });
    });
  });

  describe('when both `page` and `limit` parameters are set', function () {
    hookJobStatus({ jobID, username: 'joe', query: { page: 2, limit: 2 } });
    it('shows the corresponding page of results with the correct page size', function () {
      const job = new Job(JSON.parse(this.res.text));
      const outputLinks = job.getRelatedLinks('data');
      expect(areJobLinksEqual(links.slice(2, 4), outputLinks)).to.equal(true);
    });
  });

  describe('link relations', function () {
    describe('on the first page', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 1 } });
      it('does not provide a "prev" link relation to the previous result page', function () {
        const job = new Job(JSON.parse(this.res.text));
        const relLinks = job.getRelatedLinks('prev');
        expect(relLinks.length).to.equal(0);
      });

      it('provides a "next" link relation to the previous result page', function () {
        const job = new Job(JSON.parse(this.res.text));
        const relLinks = job.getRelatedLinks('next');
        expect(relLinks.length).to.equal(1);
      });
    });

    describe('on the second page', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 2 } });
      itIncludesPagingRelations(5, `jobs/${jobID}`, { first: null, prev: 1, self: 2, next: 3, last: 5 });
    });

    describe('on a middle page', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 3 } });
      itIncludesPagingRelations(5, `jobs/${jobID}`, { first: 1, prev: 2, self: 3, next: 4, last: 5 });
    });

    describe('on the penultimate page', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 4 } });
      itIncludesPagingRelations(5, `jobs/${jobID}`, { first: 1, prev: 3, self: 4, next: 5, last: null });
    });

    describe('on the last page', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 5 } });
      itIncludesPagingRelations(5, `jobs/${jobID}`, { first: 1, prev: 4, self: 5, next: null, last: null });
    });

    describe('for a page beyond the last page', function () {
      hookJobStatus({ jobID, username: 'joe', query: { page: 6 } });
      it('includes no data links', function () {
        const dataLinks = JSON.parse(this.res.text).links.filter((link) => link.rel === 'data');
        expect(dataLinks.length).to.equal(0);
      });
      itIncludesPagingRelations(5, `jobs/${jobID}`, { first: 1, prev: 5, self: 6, next: null, last: null });
    });

    describe('on a page that is both first and last (the only page)', function () {
      hookJobStatus({ jobID, username: 'joe', query: { limit: 100 } });
      it('includes only the relation to self, with no paging info', function () {
        const pageLinks = JSON.parse(this.res.text).links;
        expect(pageLinks.length).to.equal(53);
        expect(pageLinks[52].rel).to.equal('self');
        expect(pageLinks[52].title).to.equal('The current page');
        expect(pageLinks.find((link) => link.rel === 'prev' || link.rel === 'next')).to.be.undefined;
      });
    });

    describe('on a page with limit 0', function () {
      hookJobStatus({ jobID, username: 'joe', query: { limit: 0 } });
      it('includes only the relation to self, with no paging info', function () {
        const pageLinks = JSON.parse(this.res.text).links;
        expect(pageLinks.length).to.equal(3);
        expect(pageLinks[2].rel).to.equal('self');
        expect(pageLinks[2].title).to.equal('The current page');
        expect(pageLinks.find((link) => link.rel === 'prev' || link.rel === 'next')).to.be.undefined;
      });
    });
  });
});
