import { describe, it } from 'mocha';
import { expect } from 'chai';
import MockDate from 'mockdate';
import { buildJob } from '../helpers/jobs';
import { buildWorkflowStep } from '../helpers/workflow-steps';
import { deleteWorkflowStepsById, getWorkflowStepIdsByJobUpdateAgeAndStatus } from '../../app/models/workflow-steps';
import { JobStatus } from '../../app/models/job';
import { deleteWorkItemsById, getWorkItemIdsByJobUpdateAgeAndStatus } from '../../app/models/work-item';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildWorkItem } from '../helpers/work-items';

describe('WorkReaper-related functions', function () {
  const newDate = '1/1/2000';
  const oldDate = '1/1/1900';

  hookTransaction();

  before(async function () {
    MockDate.set(oldDate); // make the below two jobs "old"
    const failedJob = buildJob({ status: JobStatus.FAILED });
    await failedJob.save(this.trx);
    const failedItem1 = buildWorkItem({ jobID: failedJob.jobID });
    await failedItem1.save(this.trx);
    const failedItem2 = buildWorkItem({ jobID: failedJob.jobID });
    await failedItem2.save(this.trx);
    const failedStep1 = buildWorkflowStep({ jobID: failedJob.jobID, stepIndex: 1 });
    await failedStep1.save(this.trx);
    const failedStep2 = buildWorkflowStep({ jobID: failedJob.jobID, stepIndex: 2 });
    await failedStep2.save(this.trx);

    const canceledJob = buildJob({ status: JobStatus.CANCELED });
    await canceledJob.save(this.trx);
    const canceledItem1 = buildWorkItem({ jobID: canceledJob.jobID });
    await canceledItem1.save(this.trx);
    const canceledStep1 = buildWorkflowStep({ jobID: canceledJob.jobID });
    await canceledStep1.save(this.trx);
    MockDate.reset();

    MockDate.set(newDate); // make the below a "recent/new" job
    const successfulJob = buildJob({ status: JobStatus.SUCCESSFUL });
    await successfulJob.save(this.trx);
    const successfulItem1 = buildWorkItem({ jobID: successfulJob.jobID });
    await successfulItem1.save(this.trx);
    const successfulStep1 = buildWorkflowStep({ jobID: successfulJob.jobID });
    await successfulStep1.save(this.trx);
    MockDate.reset();
  });

  after(async function () {
    await truncateAll();
  });

  describe('.getWorkItemIdsByJobUpdateAgeAndStatus', function () {
    it('returns the work items and steps of jobs that have not been updated for n minutes', async function () {
      MockDate.set(newDate);

      const itemIds = await getWorkItemIdsByJobUpdateAgeAndStatus(
        this.trx,
        60,
        [JobStatus.CANCELED, JobStatus.SUCCESSFUL, JobStatus.FAILED],
      );
      expect(itemIds.length).to.eql(3);
      expect(itemIds).to.have.same.members([1, 2, 3]);

      const stepIds = await getWorkflowStepIdsByJobUpdateAgeAndStatus(
        this.trx,
        60,
        [JobStatus.CANCELED, JobStatus.SUCCESSFUL, JobStatus.FAILED],
      );
      expect(stepIds.length).to.eql(3);
      expect(stepIds).to.have.same.members([1, 2, 3]);

      MockDate.reset();
    });

    it('returns no work items / steps when they were created recently', async function () {
      MockDate.set(oldDate);

      const itemIds = await getWorkItemIdsByJobUpdateAgeAndStatus(
        this.trx,
        60,
        [JobStatus.CANCELED, JobStatus.SUCCESSFUL],
      );
      expect(itemIds.length).to.eql(0);

      const stepIds = await getWorkflowStepIdsByJobUpdateAgeAndStatus(
        this.trx,
        60,
        [JobStatus.CANCELED, JobStatus.SUCCESSFUL],
      );
      expect(stepIds.length).to.eql(0);

      MockDate.reset();
    });
  });
  describe('.deleteWorkItemsById', function () {
    it('deletes work items and steps by id', async function () {
      MockDate.set(newDate);

      // get the old work items
      const beforeDeletionItemIds = await getWorkItemIdsByJobUpdateAgeAndStatus(
        this.trx,
        60,
        [JobStatus.CANCELED, JobStatus.SUCCESSFUL, JobStatus.FAILED],
      );
      expect(beforeDeletionItemIds.length).to.eql(3);
      expect(beforeDeletionItemIds).to.have.same.members([1, 2, 3]);

      // delete the old work items
      await deleteWorkItemsById(this.trx, beforeDeletionItemIds);
      const afterDeletionItemIds = await getWorkItemIdsByJobUpdateAgeAndStatus(
        this.trx,
        60,
        [JobStatus.CANCELED, JobStatus.SUCCESSFUL, JobStatus.FAILED],
      );
      expect(afterDeletionItemIds.length).to.eql(0);

      // get the old steps
      const beforeDeletionStepIds = await getWorkflowStepIdsByJobUpdateAgeAndStatus(
        this.trx,
        60,
        [JobStatus.CANCELED, JobStatus.SUCCESSFUL, JobStatus.FAILED],
      );
      expect(beforeDeletionStepIds.length).to.eql(3);
      expect(beforeDeletionStepIds).to.have.same.members([1, 2, 3]);

      // delete the old steps
      await deleteWorkflowStepsById(this.trx, beforeDeletionItemIds);
      const afterDeletionStepIds = await getWorkflowStepIdsByJobUpdateAgeAndStatus(
        this.trx,
        60,
        [JobStatus.CANCELED, JobStatus.SUCCESSFUL, JobStatus.FAILED],
      );
      expect(afterDeletionStepIds.length).to.eql(0);

      MockDate.reset();
    });
  });
});
