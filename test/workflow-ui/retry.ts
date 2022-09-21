import { describe } from 'mocha';
import { buildJob } from '../helpers/jobs';
import { JobStatus } from '../../app/models/job';
import { getWorkItemById, getWorkItemsByJobId } from '../../app/models/work-item';
import { hookTransaction } from '../helpers/db';
import { buildWorkItem } from '../helpers/work-items';
import db from '../../app/util/db';
import { expect } from 'chai';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import env from '../../app/util/env';
import { buildWorkflowStep } from '../helpers/workflow-steps';
import { hookWorkflowUIWorkItemRetry } from '../helpers/workflow-ui';
import hookServersStartStop from '../helpers/servers';


describe('Workflow UI retry', function () {
  let retryLimit: number;

  const job = buildJob({ username: 'bo', status: JobStatus.RUNNING, ignoreErrors: true });
  const item1 = buildWorkItem({ jobID: job.jobID, status: WorkItemStatus.RUNNING, workflowStepIndex: 0, id: 1 });
  const item2 = buildWorkItem({ jobID: job.jobID, status: WorkItemStatus.RUNNING, workflowStepIndex: 0, id: 2 });

  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();

  before(async function () {
    // Set the limit to something small for these tests
    retryLimit = env.workItemRetryLimit;
    env.workItemRetryLimit = 1;

    await job.save(this.trx);
    
    await item1.save(this.trx);
    await item2.save(this.trx);
    await buildWorkflowStep({ jobID: item2.jobID, stepIndex: 0 }).save(this.trx);
    
    await this.trx.commit();
  });

  after(async function () {
    env.workItemRetryLimit = retryLimit;
  });

  describe('when a retry is triggered for a user\'s work item', async function () {
    hookWorkflowUIWorkItemRetry({ username: 'bo', jobID: job.jobID, id: item1.id });
    
    it('returns a 200 HTTP response', async function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns a success message', async function () {
      expect(JSON.parse(this.res.text).message).to.equal('The item was successfully requeued.');
    });

    it('requeues the item and increments its retry count', async function () {
      // check that the one item was re-queued
      const items = (await getWorkItemsByJobId(db, job.jobID)).workItems;
      expect(items.filter((item) => item.status === WorkItemStatus.READY).length).to.equal(1);
      const expectedItem = await getWorkItemById(db, item1.id);
      expect(expectedItem.retryCount).to.equal(1);
    });
  });

  describe('when a retry is triggered for a user\'s work item but the retry limit is exhausted', async function () {
    hookWorkflowUIWorkItemRetry({ username: 'bo', jobID: job.jobID, id: item1.id });

    it('returns an informative message', async function () {
      expect(JSON.parse(this.res.text).message).to.equal('The item does not have any retries left.');
    });

    it('does not retry the item', async function () {
      const expectedItem = await getWorkItemById(db, item1.id);
      expect(expectedItem.retryCount).to.equal(1);
    });
  });

  describe('when an admin triggers a retry for another user\'s work item', async function () {
    hookWorkflowUIWorkItemRetry({ username: 'adam', jobID: job.jobID, id: item1.id });
    
    it('allows the request', async function () {
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('when a non-admin triggers a retry for another user\'s work item', async function () {
    hookWorkflowUIWorkItemRetry({ username: 'not-bo', jobID: job.jobID, id: item1.id });
    
    it('does not allow the request', async function () {
      expect(this.res.statusCode).to.equal(403);
    });
  });
});
