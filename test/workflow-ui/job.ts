import * as mustache from 'mustache';
import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { workflowUIJob, hookWorkflowUIJob, hookAdminWorkflowUIJob } from '../helpers/workflow-ui';

// Example job to use in tests
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

describe('Workflow UI job route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  before(async function () {
    await truncateAll();
  });

  after(async function () {
    await truncateAll();
  });

  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await workflowUIJob(this.frontend, { jobID: woodyJob1.jobID }).redirects(0);
    });

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/workflow-ui/${woodyJob1.jobID}`));
    });
  });

  describe('For a logged-in user', function () {
    hookTransaction();
    before(async function () {
      await woodyJob1.save(this.trx);
      this.trx.commit();
    });

    describe('who requests their own job', function () {
      hookWorkflowUIJob({ jobID: woodyJob1.jobID, username: 'woody' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns HTML with the job ID included', function () {
        const listing = this.res.text;
        expect(listing).to.contain(mustache.render('{{req}}', { req: woodyJob1.jobID }));
      });

      it('returns a breadcrumb that includes the non-admin path', async function () {
        const listing = this.res.text;
        expect(listing).to.contain(mustache.render('<a href="/workflow-ui">Jobs</a>', {}));
      });
    });

    describe('For a non-existent job ID', function () {
      const unknownRequest = uuid();
      hookWorkflowUIJob({ jobID: unknownRequest, username: 'woody' });
      it('returns a 404 HTTP Not found response', function () {
        expect(this.res.statusCode).to.equal(404);
      });

      it('returns a JSON error response', function () {
        expect(this.res.text).to.include(`Unable to find job ${unknownRequest}`);
      });
    });

    describe('For an invalid job ID format', function () {
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

    describe('when accessing the admin endpoint', function () {
      describe('when the user is part of the admin group', function () {
        hookAdminWorkflowUIJob({ jobID: woodyJob1.jobID, username: 'adam' });
        it('returns a job for any user', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{req}}', { req: woodyJob1.jobID }));
        });

        it('returns a breadcrumb that includes the admin path', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<a href="{{adminRoute}}/workflow-ui">Jobs</a>', { adminRoute: '/admin' }));
        });
      });

      describe('when the user is not part of the admin group', function () {
        hookAdminWorkflowUIJob({ jobID: woodyJob1.jobID, username: 'eve' });
        it('returns an error', function () {
          expect(this.res.statusCode).to.equal(403);
          expect(this.res.text).to.include('You are not permitted to access this resource');
        });
      });
    });
  });
});
