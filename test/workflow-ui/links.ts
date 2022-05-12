import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, tables, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { hookWorkflowUILinks, hookAdminWorkflowUILinks } from '../helpers/workflow-ui';

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

describe('Workflow UI job links route', function () {
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
    describe('when a non-admin user', function () {
      describe('requests links for their own job', function () {
        hookWorkflowUILinks({ jobID: nonShareableJob.jobID, username: 'woody' });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns job state change links', function () {
          const links = JSON.parse(this.res.text);
          expect(links.length).to.eql(4);
        });
      });
      describe('requests links for a shareable job that they do not own', function () {
        hookWorkflowUILinks({ jobID: shareableJob.jobID, username: 'woody' });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns an empty links array', function () {
          const links = JSON.parse(this.res.text);
          expect(links.length).to.eql(0);
        });
      });
      describe('requests links for a job that does not exist', function () {
        const unknownRequest = uuid();
        hookWorkflowUILinks({ jobID: unknownRequest, username: 'woody' });
        it('returns a 404 HTTP Not Found response', function () {
          expect(this.res.statusCode).to.equal(404);
          expect(this.res.text).to.include(`Unable to find job ${unknownRequest}`);
        });
      });
    });
    describe('when an admin user', function () {
      describe('requests links for a non-shareable job they do not own', function () {
        hookWorkflowUILinks({ jobID: nonShareableJob.jobID, username: 'adam' });
        it('returns a 404 HTTP Not Found response', function () {
          expect(this.res.statusCode).to.equal(404);
          expect(this.res.text).to.include('The requested resource could not be found');
        });
      });
    });
  });
  describe('for the admin endpoint', function () {
    describe('when an admin user', function () {
      describe('requests links for a non-shareable job they do not own', function () {
        hookAdminWorkflowUILinks({ jobID: nonShareableJob.jobID, username: 'adam' });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns job state change links', function () {
          const links = JSON.parse(this.res.text);
          expect(links.length).to.eql(4);
        });
      });
    });
    describe('when a non-admin user', function () {
      describe('requests links for a job they do not own', function () {
        hookAdminWorkflowUILinks({ jobID: nonShareableJob.jobID, username: 'eve' });
        it('returns a 403 HTTP Forbidden response', function () {
          expect(this.res.statusCode).to.equal(403);
          expect(this.res.text).to.include('You are not permitted to access this resource');
        });
      });
    });
  });
});
