import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import { Job, JobStatus, JobRecord } from 'models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, hookTransactionFailure, truncateAll } from '../helpers/db';
import { containsJob, jobListing, hookJobListing, createIndexedJobs, itIncludesPagingRelations, hookAdminJobListing } from '../helpers/jobs';


// Example jobs to use in tests
const woodyJob1: JobRecord = {
  username: 'woody',
  requestId: uuid().toString(),
  status: JobStatus.SUCCESSFUL,
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1', rel: 'link', type: 'text/plain' }],
  request: 'http://example.com/harmony?request=woody1',
  isAsync: true,
};

const woodyJob2: JobRecord = {
  username: 'woody',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 60,
  links: [],
  request: 'http://example.com/harmony?request=woody2',
  isAsync: true,
};

const woodySyncJob: JobRecord = {
  username: 'woody',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 60,
  links: [],
  request: 'http://example.com/harmony?request=woody2',
  isAsync: false,
};

const buzzJob1: JobRecord = {
  username: 'buzz',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 30,
  links: [],
  request: 'http://example.com/harmony?request=buzz1',
  isAsync: true,
};

describe('Jobs listing route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await jobListing(this.frontend).redirects(0);
    });

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/jobs'));
    });
  });

  describe('For a logged-in user', function () {
    hookTransaction();
    before(async function () {
      // Add all jobs to the database
      await new Job(woodyJob1).save(this.trx);
      await new Job(woodyJob2).save(this.trx);
      await new Job(woodySyncJob).save(this.trx);
      await new Job(buzzJob1).save(this.trx);
      this.trx.commit();
    });

    describe('Who has no jobs', function () {
      hookJobListing({ username: 'andy' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an empty JSON job list', function () {
        expect(JSON.parse(this.res.text).jobs).to.eql([]);
      });
    });

    describe('Who has jobs', function () {
      hookJobListing({ username: 'woody' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a list of the user’s job records in JSON format', function () {
        const listing = JSON.parse(this.res.text);
        expect(containsJob(woodyJob1, listing)).to.be.true;
        expect(containsJob(woodyJob2, listing)).to.be.true;
      });

      it('does not return jobs for other users', function () {
        const listing = JSON.parse(this.res.text);
        expect(containsJob(buzzJob1, listing)).to.be.false;
      });

      it('does not return synchronous jobs', function () {
        const listing = JSON.parse(this.res.text);
        expect(containsJob(woodySyncJob, listing)).to.be.false;
      });
    });
  });

  describe('When the database catches fire', function () {
    hookTransactionFailure();
    hookJobListing({ username: 'woody' });
    describe('for a user that should have jobs', function () {
      it('returns an internal server error status code', function () {
        expect(this.res.statusCode).to.equal(500);
      });

      it('includes an error message in JSON format indicating a server error', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:ServerError',
          description: 'Error: Internal server error trying to retrieve jobs listing',
        });
      });
    });
  });

  describe('pagination', function () {
    hookTransaction();
    before(async function () {
      this.jobs = await createIndexedJobs(this.trx, 'paige', 51);
      this.trx.commit();
    });

    describe('paging headers', function () {
      hookJobListing({ username: 'paige' });
      it('sets the `Harmony-Hits` header to the total number of jobs', function () {
        expect(this.res.headers['harmony-hits']).to.equal(this.jobs.length.toString());
      });
    });

    describe('`count` property', function () {
      hookJobListing({ username: 'paige' });
      it('sets the `count` property in the response to the total number of jobs', function () {
        const { count } = JSON.parse(this.res.text);
        expect(count).to.equal(this.jobs.length);
      });
    });

    describe('`limit` parameter', function () {
      describe('when `limit` is not set', function () {
        hookJobListing({ username: 'paige' });
        it('returns the default number of jobs (10)', function () {
          const { jobs } = JSON.parse(this.res.text);
          expect(jobs.length).to.equal(10);
        });
      });

      describe('when `limit` is set to a valid value lower than the total number of results', function () {
        hookJobListing({ username: 'paige', limit: 20 });
        it('returns a number of jobs equal to the provided limit', function () {
          const { jobs } = JSON.parse(this.res.text);
          expect(jobs.length).to.equal(20);
        });
      });

      describe('when `limit` is set to a valid value greater than the total number of results', function () {
        hookJobListing({ username: 'paige', limit: 2000 });
        it('returns all of the jobs', function () {
          const { jobs } = JSON.parse(this.res.text);
          expect(jobs.length).to.equal(this.jobs.length);
        });
      });

      describe('when `limit` is set to an invalid number', function () {
        hookJobListing({ username: 'paige', limit: 25.3 });
        it('returns a validation error explaining limit parameter constraints', function () {
          const error = JSON.parse(this.res.text);
          expect(this.res.statusCode).to.equal(400);
          expect(error).to.eql({
            code: 'harmony:RequestValidationError',
            description: 'Error: Parameter "limit" is invalid. Must be an integer greater than or equal to 0 and less than or equal to 2000.',
          });
        });
      });

      describe('when `limit` is set to a value greater than the maximum allowable', function () {
        hookJobListing({ username: 'paige', limit: 2001 });
        it('returns a validation error explaining limit parameter constraints', function () {
          const error = JSON.parse(this.res.text);
          expect(this.res.statusCode).to.equal(400);
          expect(error).to.eql({
            code: 'harmony:RequestValidationError',
            description: 'Error: Parameter "limit" is invalid. Must be an integer greater than or equal to 0 and less than or equal to 2000.',
          });
        });
      });

      describe('when `limit` is set to a value lower than the minimum allowable', function () {
        hookJobListing({ username: 'paige', limit: -1 });
        it('returns a validation error explaining limit parameter constraints', function () {
          const error = JSON.parse(this.res.text);
          expect(this.res.statusCode).to.equal(400);
          expect(error).to.eql({
            code: 'harmony:RequestValidationError',
            description: 'Error: Parameter "limit" is invalid. Must be an integer greater than or equal to 0 and less than or equal to 2000.',
          });
        });
      });
    });

    describe('`page` parameter', function () {
      describe('when `page` is not set', function () {
        hookJobListing({ username: 'paige' });
        it('returns the first page of results', function () {
          const { jobs } = JSON.parse(this.res.text);
          expect(jobs.length).to.equal(10);
          expect(jobs[0].progress).to.equal(0);
          expect(jobs[9].progress).to.equal(9);
        });
      });

      describe('when `page` is set to a valid page of results', function () {
        hookJobListing({ username: 'paige', page: 3 });
        it('returns the requested page', function () {
          const { jobs } = JSON.parse(this.res.text);
          expect(jobs.length).to.equal(10);
          expect(jobs[0].progress).to.equal(20);
          expect(jobs[9].progress).to.equal(29);
        });
      });

      describe('when `page` is set to the last page of results', function () {
        hookJobListing({ username: 'paige', page: 6 });
        it('returns the last page, with fewer items than the limit if applicable', function () {
          const { jobs } = JSON.parse(this.res.text);
          expect(jobs.length).to.equal(1);
          expect(jobs[0].progress).to.equal(50);
        });
      });

      describe('when `page` is set to a page after the last page', function () {
        hookJobListing({ username: 'paige', page: 100 });
        it('returns an empty list of results', function () {
          const { jobs } = JSON.parse(this.res.text);
          expect(jobs.length).to.equal(0);
        });
      });

      describe('when `page` is set to a page before the first page', function () {
        hookJobListing({ username: 'paige', page: 0 });
        it('returns a validation error explaining page parameter constraints', function () {
          const error = JSON.parse(this.res.text);
          expect(this.res.statusCode).to.equal(400);
          expect(error).to.eql({
            code: 'harmony:RequestValidationError',
            description: 'Error: Parameter "page" is invalid. Must be an integer greater than or equal to 1.',
          });
        });
      });

      describe('when `page` is set to an invalid number', function () {
        hookJobListing({ username: 'paige', page: 2.5 });
        it('returns a validation error explaining page parameter constraints', function () {
          const error = JSON.parse(this.res.text);
          expect(this.res.statusCode).to.equal(400);
          expect(error).to.eql({
            code: 'harmony:RequestValidationError',
            description: 'Error: Parameter "page" is invalid. Must be an integer greater than or equal to 1.',
          });
        });
      });
    });

    describe('link relations', function () {
      describe('on the first page', function () {
        hookJobListing({ username: 'paige', page: 1 });
        itIncludesPagingRelations(6, { first: null, prev: null, self: 1, next: 2, last: 6 });
      });

      describe('on the second page', function () {
        hookJobListing({ username: 'paige', page: 2 });
        itIncludesPagingRelations(6, { first: null, prev: 1, self: 2, next: 3, last: 6 });
      });

      describe('on a middle page', function () {
        hookJobListing({ username: 'paige', page: 3 });
        itIncludesPagingRelations(6, { first: 1, prev: 2, self: 3, next: 4, last: 6 });
      });

      describe('on the penultimate page', function () {
        hookJobListing({ username: 'paige', page: 5 });
        itIncludesPagingRelations(6, { first: 1, prev: 4, self: 5, next: 6, last: null });
      });

      describe('on the last page', function () {
        hookJobListing({ username: 'paige', page: 6 });
        itIncludesPagingRelations(6, { first: 1, prev: 5, self: 6, next: null, last: null });
      });

      describe('on the only page', function () {
        hookJobListing({ username: 'paige', page: 1, limit: 500 });
        it('includes only the relation to self, with no paging info', function () {
          const { links } = JSON.parse(this.res.text);
          expect(links.length).to.equal(1);
          expect(links[0].rel).to.equal('self');
          expect(links[0].title).to.equal('The current page');
        });
      });

      describe('on a page with limit 0', function () {
        hookJobListing({ username: 'paige', page: 1, limit: 0 });
        it('includes only the relation to self, with no paging info', function () {
          const { links } = JSON.parse(this.res.text);
          expect(links.length).to.equal(1);
          expect(links[0].rel).to.equal('self');
          expect(links[0].title).to.equal('The current page');
        });
      });
    });
  });

  describe('admin access', function () {
    before(truncateAll);
    hookTransaction();
    before(async function () {
      this.jobs = await createIndexedJobs(this.trx, 'paige', 51);
      this.trx.commit();
    });

    describe('when the user is part of the admin group', function () {
      hookAdminJobListing({ username: 'adam' });
      it('returns jobs for all users', function () {
        const { count } = JSON.parse(this.res.text);
        expect(count).to.equal(this.jobs.length);
      });
    });

    describe('when the user is not part of the admin group', function () {
      hookAdminJobListing({ username: 'eve' });
      it('returns an error', function () {
        expect(this.res.statusCode).to.equal(403);
        expect(this.res.text).to.include('You are not permitted to access this resource');
      });
    });
  });
});
