import * as mustache from 'mustache';
import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, tables, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { workflowUIJob, hookWorkflowUIJob, hookAdminWorkflowUIJob } from '../helpers/workflow-ui';

const collectionWithEULAFalseAndGuestReadTrue = 'C1233800302-EEDTEST';

// Example jobs to use in tests
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
const shareableJob = buildJob({
  username: 'buzz',
  status: JobStatus.SUCCESSFUL,
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1', rel: 'link', type: 'text/plain' }],
  request: 'http://example.com/harmony?request=buzz1&turbo=true',
  isAsync: true,
  numInputGranules: 3,
  collectionIds: [collectionWithEULAFalseAndGuestReadTrue],
});

describe('Workflow UI job route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();

  before(async function () {
    await Promise.all(tables.map((t) => this.trx(t).truncate()));
    await nonShareableJob.save(this.trx);
    await shareableJob.save(this.trx);
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
      describe('requests a shareable job that they do not own', function () {
        hookWorkflowUIJob({ jobID: shareableJob.jobID, username: 'woody' });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns HTML with the job ID included', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{req}}', { req: shareableJob.jobID }));
        });
      });
      describe('requests a job that does not exist', function () {
        const unknownRequest = uuid();
        hookWorkflowUIJob({ jobID: unknownRequest, username: 'woody' });
        it('returns a 404 HTTP Not Found response', function () {
          expect(this.res.statusCode).to.equal(404);
          expect(this.res.text).to.include('The requested resource could not be found');
        });
      });
      describe('requests a job with an invalid ID format', function () {
        hookWorkflowUIJob({ jobID: 'not-a-uuid', username: 'woody' });
        it('returns a 400 HTTP Bad Request response', function () {
          expect(this.res.statusCode).to.equal(400);
          expect(this.res.text).to.include('Invalid format for Job ID');
        });
      });
      describe('filters by status IN [failed, successful]', function () {
        const tableFilter = '[{"value":"status: failed","dbValue":"failed","field":"status"},{"value":"status: successful","dbValue":"successful","field":"status"}]';
        hookWorkflowUIJob({ jobID: nonShareableJob.jobID, username: 'woody', query: { disallowStatus: '', tableFilter } });
        it('does not have disallowStatus HTML checked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
        });
        it('has the appropriate status options selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain('status: failed');
          expect(listing).to.contain('status: successful');
          expect(listing).to.not.contain('status: running');
          expect(listing).to.not.contain('status: ready');
          expect(listing).to.not.contain('status: canceled');
        });
      });
    });
    describe('when an admin user', function () {
      describe('requests a non-shareable job they do not own', function () {
        hookWorkflowUIJob({ jobID: nonShareableJob.jobID, username: 'adam' });
        it('returns a 200 response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
    });
  });
  describe('for the admin endpoint', function () {
    describe('when an admin user', function () {
      describe('requests a non-shareable job they do not own', function () {
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
      describe('filters by status NOT IN [running]', function () {
        const tableFilter = '[{"value":"status: running","dbValue":"running","field":"running"}]';
        hookWorkflowUIJob({ jobID: nonShareableJob.jobID, username: 'adam', query: { disallowStatus: 'on', tableFilter } });
        it('does have disallowStatus HTML checked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowStatus")(?=.*checked).*>/g) || []).length).to.equal(1);
        });
        it('has the appropriate status options selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain('status: running');
          expect(listing).to.not.contain('status: failed');
          expect(listing).to.not.contain('status: successful');
          expect(listing).to.not.contain('status: ready');
          expect(listing).to.not.contain('status: canceled');
        });
      });
    });
    describe('when a non-admin user', function () {
      describe('requests a job they do not own', function () {
        hookAdminWorkflowUIJob({ jobID: nonShareableJob.jobID, username: 'eve' });
        it('returns a 403 HTTP Forbidden response', function () {
          expect(this.res.statusCode).to.equal(403);
          expect(this.res.text).to.include('You are not permitted to access this resource');
        });
      });
    });
  });
});
