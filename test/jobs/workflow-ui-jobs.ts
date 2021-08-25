import * as mustache from 'mustache';
import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, truncateAll } from '../helpers/db';
import { workflowUIJobs, buildJob, hookWorkflowUIJobs, hookAdminWorkflowUIJobs } from '../helpers/jobs';

// Example jobs to use in tests
const woodyJob1 = buildJob({
  username: 'woody',
  status: JobStatus.SUCCESSFUL,
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1', rel: 'link', type: 'text/plain' }],
  request: 'http://example.com/harmony?request=woody1&turbo=true',
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
  status: JobStatus.RUNNING,
  message: 'In progress',
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
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/jobs'));
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

    describe('Who has no jobs', function () {
      hookWorkflowUIJobs({ username: 'andy' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an empty jobs table', function () {
        expect(this.res.text).to.not.contain('job-table-row');
      });
    });

    describe('Who has jobs', function () {
      hookWorkflowUIJobs({ username: 'woody' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an HTML table of info regarding the user’s jobs', function () {
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

    describe('admin access', function () {
      describe('when the user is part of the admin group', function () {
        hookAdminWorkflowUIJobs({ username: 'adam', limit: 100 });
        it('returns jobs for all users', async function () {
          const listing = this.res.text;
          [woodyJob1.request, woodyJob2.request, woodySyncJob.request, buzzJob1.request]
            .forEach((req) => expect(listing).to.contain(mustache.render('{{req}}', { req })));
          expect((listing.match(/job-table-row/g) || []).length).to.equal(4);
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
