import * as mustache from 'mustache';
import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { workflowUIJobs, hookWorkflowUIJobs, hookAdminWorkflowUIJobs } from '../helpers/workflow-ui';
import env from '../../app/util/env';

// Example jobs to use in tests
const woodyJob1 = buildJob({
  username: 'woody',
  status: JobStatus.SUCCESSFUL,
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1', rel: 'link', type: 'text/plain' }],
  request: 'http://example.com/harmony?request=woody1&turbo=false',
  isAsync: true,
  numInputGranules: 3,
});

const woodyJob2 = buildJob({
  username: 'woody',
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 60,
  links: [{ href: 's3://somebucket/mydata', rel: 'data', type: 'image/tiff' }],
  request: 'http://example.com/harmony?request=woody2&turbo=true',
  isAsync: true,
  numInputGranules: 5,
});

const woodySyncJob = buildJob({
  username: 'woody',
  status: JobStatus.FAILED,
  message: 'The job failed :(',
  progress: 0,
  links: [],
  request: 'http://example.com/harmony?request=woody2',
  isAsync: false,
  numInputGranules: 1,
});

const buzzJob1 = buildJob({
  username: 'buzz',
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 30,
  links: [],
  request: 'http://example.com/harmony?request=buzz1&turbo=true',
  isAsync: true,
  numInputGranules: 10,
});

describe('Workflow UI jobs route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  before(async function () {
    await truncateAll();
  });

  after(async function () {
    await truncateAll();
  });

  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await workflowUIJobs(this.frontend).redirects(0);
    });

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/workflow-ui'));
    });
  });

  describe('For a logged-in user', function () {
    hookTransaction();
    before(async function () {
      // Add all jobs to the database
      await woodyJob1.save(this.trx);
      await woodyJob2.save(this.trx);
      await woodySyncJob.save(this.trx);
      await buzzJob1.save(this.trx);
      this.trx.commit();
    });

    describe('who has no jobs', function () {
      hookWorkflowUIJobs({ username: 'andy' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an empty jobs table', function () {
        expect(this.res.text).to.not.contain('job-table-row');
      });
    });

    describe('who has jobs', function () {
      hookWorkflowUIJobs({ username: 'woody' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an HTML table of info regarding the user\'s jobs', function () {
        const listing = this.res.text;
        [woodyJob1.request, woodyJob2.request, woodySyncJob.request]
          .forEach((req) => expect(listing).to.contain(mustache.render('{{req}}', { req })));
        expect((listing.match(/job-table-row/g) || []).length).to.equal(3);
      });

      it('does not return jobs for other users', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain(mustache.render('{{req}}', { req: buzzJob1.request }));
      });
    });

    describe('who has 3 jobs and asks for page 1, with a limit of 1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1 });
      it('returns a link to the next page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(mustache.render('{{nextLink}}', { nextLink: '/workflow-ui?limit=1&page=2' }));
      });
      it('returns only one job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who asks for more than env.maxPageSize jobs', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: env.maxPageSize + 999 });
      it('returns all of the users jobs without error', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(3);
      });
    });

    describe('who has 3 jobs and asks for page 2, with a limit of 1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, page: 2 });
      it('returns a link to the next and previous page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(mustache.render('{{nextLink}}', { nextLink: '/workflow-ui?limit=1&page=1' }));
        expect(listing).to.contain(mustache.render('{{prevLink}}', { prevLink: '/workflow-ui?limit=1&page=3' }));
      });
      it('returns only one job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who filters by status IN [failed]', function () {
      hookWorkflowUIJobs({ username: 'woody', jobsFilter: '[{"value":"status: failed","dbValue":"failed","field":"status"}]' });
      it('returns only failed jobs', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does not have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.not.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('who filters by status IN [failed, successful]', function () {
      const jobsFilter = '[{"value":"status: failed","dbValue":"failed","field":"status"},{"value":"status: successful","dbValue":"successful","field":"status"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowStatus: '', jobsFilter });
      it('returns failed and successful jobs', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(2);
        expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does not have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('who filters by an invalid status (working)', function () {
      hookWorkflowUIJobs({ username: 'woody', jobsFilter: '[{"value":"status: working","dbValue":"working","field":"status"}, {"value":"status: running","dbValue":"running","field":"status"}]' });
      it('ignores the invalid status', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain('status: working');
        expect(listing).to.contain('status: running');
      });
    });

    describe('who filters by an invalid username (w oody)', function () {
      hookWorkflowUIJobs({ username: 'woody', jobsFilter: '[{"value":"user: w oody"}, {"value":"user: woody"}]' });
      it('ignores the invalid username', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain('user: w oody');
        expect(listing).to.contain('user: woody');
      });
    });

    describe('who filters by status NOT IN [failed, successful]', function () {
      const jobsFilter = '[{"value":"status: failed","dbValue":"failed","field":"status"},{"value":"status: successful","dbValue":"successful","field":"status"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowStatus: 'on', jobsFilter });
      it('returns all jobs that are not failed or successful', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        expect(listing).to.not.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?=.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('when accessing the admin endpoint', function () {
      describe('when the user is part of the admin group', function () {
        hookAdminWorkflowUIJobs({ username: 'adam', limit: 100 });
        it('returns jobs for all users', async function () {
          const listing = this.res.text;
          [woodyJob1.request, woodyJob2.request, woodySyncJob.request, buzzJob1.request]
            .forEach((req) => expect(listing).to.contain(mustache.render('{{req}}', { req })));
          expect((listing.match(/job-table-row/g) || []).length).to.equal(4);
        });

        it('shows the users that submitted those jobs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain('woody');
          expect(listing).to.contain('buzz');
        });
      });

      describe('when the user is not part of the admin group', function () {
        hookAdminWorkflowUIJobs({ username: 'eve' });
        it('returns an error', function () {
          expect(this.res.statusCode).to.equal(403);
          expect(this.res.text).to.include('You are not permitted to access this resource');
        });
      });
    });
  });
});
