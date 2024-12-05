/* eslint-disable import/no-named-as-default-member */
import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { buildWorkItem } from '../helpers/work-items';
import { buildWorkflowStep } from '../helpers/workflow-steps';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { hookWorkflowUILogs, workflowUILogs } from '../helpers/workflow-ui';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import sinon from 'sinon';
import { FileStore } from '../../app/util/object-store/file-store';

// main objects used in the tests
const targetJob = buildJob({ status: JobStatus.FAILED, username: 'bo' });

// build docker image urls / serviceIds
const ecrImage = 'dataservices/query-it:latest';
const ecrLocation = '00000000.xyz.abc.region-5.amazonaws.com/';
const step1ServiceId = `${ecrLocation}${ecrImage}`;

// build the steps
const step1 = buildWorkflowStep(
  { jobID: targetJob.jobID, stepIndex: 1, serviceID: step1ServiceId },
);

// build the items
const item1 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 1, serviceID: step1ServiceId, status: WorkItemStatus.SUCCESSFUL },
);

describe('Workflow UI directly accessing log files', function () {

  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  before(async function () {
    await truncateAll();
  });

  after(async function () {
    await truncateAll();
  });

  describe('for a user who is not logged in', function () {
    before(async function () {
      this.res = await workflowUILogs(
        this.frontend, { jobID: 'foo', id: 123 },
      ).redirects(0);
    });

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/logs/foo/123'));
    });
  });

  describe('for logged-in users', async function () {
    // First save the jobs so that they have IDs
    hookTransaction();
    let getObjectJsonStub;
    before(async function () {
      await targetJob.save(this.trx);
      await item1.save(this.trx);
      await step1.save(this.trx);
      await this.trx.commit();

      // Mock out the calls to S3 to just return arbitrary JSON for the logs
      getObjectJsonStub = sinon.stub(FileStore.prototype, 'getObjectJson').resolves({ foo: 'bar' });
    });

    after(async function () {
      if (getObjectJsonStub.restore) getObjectJsonStub.restore();
    });

    describe('when requesting the logs as the user that owns the job, (but is not a log viewer)', function () {
      hookWorkflowUILogs({ jobID: targetJob.jobID, id: 1, username: 'bo' });
      it('returns a 403 status code', function () {
        expect(this.res.statusCode).to.equal(403);
      });
      it('returns a message indicating authorization issue', function () {
        expect(this.res.text).to.include('You are not authorized to access the requested resource');
      });
    });

    describe('when requesting the logs for someone else\'s job (but is an admin)', async function () {
      hookWorkflowUILogs({ jobID: targetJob.jobID, id: 1, username: 'adam' });
      it('returns a 200 status code', function () {
        expect(this.res.statusCode).to.equal(200);
      });
    });

    describe('when requesting the logs for someone else\'s job (but is a log viewer)', async function () {
      hookWorkflowUILogs({ jobID: targetJob.jobID, id: 1, username: 'log-viewer-not-bo' });
      it('returns a 200 status code', function () {
        expect(this.res.statusCode).to.equal(200);
      });
    });
  });
});