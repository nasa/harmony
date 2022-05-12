import * as mustache from 'mustache';
import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, tables, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { workflowUIJob, hookWorkflowUIJob, hookAdminWorkflowUIJob } from '../helpers/workflow-ui';

// Example job to use in tests
const nonShareableJob = buildJob({
  username: 'woody',
  status: JobStatus.SUCCESSFUL,
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1', rel: 'link', type: 'text/plain' }],
  request: 'http://example.com/harmony?request=woody1&turbo=true',
  isAsync: true,
  numInputGranules: 3,
});

describe('Workflow UI job route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();

  before(async function () {
    await Promise.all(tables.map((t) => this.trx(t).truncate()));
    await nonShareableJob.save(this.trx);
    this.trx.commit();
  });

  after(async function () {
    await truncateAll();
  });

  describe('for the non-admin endpoint', function () {
    describe('when a user is not logged in', function () {
      before(async function () {
        this.res = await workflowUIJob(this.frontend, { jobID: nonShareableJob.jobID }).redirects(0);
      });
      it('redirects to Earthdata Login', function () {
        expect(this.res.statusCode).to.equal(303);
        expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
      });
      it('sets the "redirect" cookie to the originally-requested resource', function () {
        expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/workflow-ui/${nonShareableJob.jobID}`));
      });
    });
    describe('when a non-admin user', function () {
      describe('requests their own job', function () {
        hookWorkflowUIJob({ jobID: nonShareableJob.jobID, username: 'woody' });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns HTML with the job ID included', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{req}}', { req: nonShareableJob.jobID }));
        });
        it('returns a breadcrumb that includes the non-admin path', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<a href="/workflow-ui">Jobs</a>', {}));
        });
      });
      describe('requests a job that does not exist', function () {
        const unknownRequest = uuid();
        hookWorkflowUIJob({ jobID: unknownRequest, username: 'woody' });
        it('returns a 404 HTTP Not found response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
        it('returns a JSON error response', function () {
          expect(this.res.text).to.include(`Unable to find job ${unknownRequest}`);
        });
      });
      describe('requests a job with an invalid ID format', function () {
        hookWorkflowUIJob({ jobID: 'not-a-uuid', username: 'woody' });
        it('returns a 404 HTTP Not found response', function () {
          expect(this.res.statusCode).to.equal(400);
        });
        it('returns a JSON error response', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony.RequestValidationError',
            description: 'Error: Invalid format for Job ID \'not-a-uuid\'. Job ID must be a UUID.',
          });
        });
      });
    });
    describe('when an admin user', function () {
      describe('requests a job they do not own', function () {
        hookWorkflowUIJob({ jobID: nonShareableJob.jobID, username: 'adam' });
        it('returns an error', function () {
          expect(this.res.statusCode).to.equal(404);
          expect(this.res.text).to.include('The requested resource could not be found');
        });
      });
    });
  });
  describe('for the admin endpoint', function () {
    describe('when an admin user', function () {
      describe('requests a job they do not own', function () {
        hookAdminWorkflowUIJob({ jobID: nonShareableJob.jobID, username: 'adam' });
        it('returns a job for any user', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{req}}', { req: nonShareableJob.jobID }));
        });
        it('returns a breadcrumb that includes the admin path', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<a href="/admin/workflow-ui">Jobs</a>', {}));
        });
      });
    });
    describe('when a non-admin user', function () {
      describe('requests a job they do not own', function () {
        hookAdminWorkflowUIJob({ jobID: nonShareableJob.jobID, username: 'eve' });
        it('returns an error', function () {
          expect(this.res.statusCode).to.equal(403);
          expect(this.res.text).to.include('You are not permitted to access this resource');
        });
      });
    });
  });
});
