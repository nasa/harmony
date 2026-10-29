import { expect } from 'chai';
import { describe, it } from 'mocha';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import {
  WorkItemUpdateQueueItem, processWorkItems,
} from '../../app/backends/workflow-orchestration/work-item-updates';
import { Job, JobStatus } from '../../app/models/job';
import { getWorkItemsByJobIdAndStepIndex } from '../../app/models/work-item';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import { getWorkflowStepByJobIdStepIndex } from '../../app/models/workflow-steps';
import db from '../../app/util/db';
import logger from '../../app/util/log';
import { rawSaveJob } from '../helpers/jobs';
import { populateUserWorkFromWorkItems } from '../helpers/user-work';
import { rawSaveWorkItem } from '../helpers/work-items';
import { rawSaveWorkflowStep } from '../helpers/workflow-steps';

/**
 * Builds a WorkItemUpdateQueueItem for a successful work item with the given id, with a
 * pre-built preprocessResult so the real S3-backed preprocessWorkItem is not needed.
 * @param workItemID - the id of the work item being updated
 * @returns a work item update queue item ready to pass to processWorkItems
 */
function buildSuccessfulUpdateItem(workItemID: number): WorkItemUpdateQueueItem {
  return {
    update: {
      workItemID,
      status: WorkItemStatus.SUCCESSFUL,
      results: [`s3://fake-bucket/${workItemID}/catalog0.json`],
      outputItemSizes: [100],
      totalItemsSize: 0.0001,
      duration: 1000,
    },
    preprocessResult: {
      status: WorkItemStatus.SUCCESSFUL,
      catalogItems: [],
      outputItemSizes: [100],
    },
  };
}

/**
 * Builds a WorkItemUpdateQueueItem for a failed (non-retriable) work item with the given id.
 * @param workItemID - the id of the work item being updated
 * @returns a work item update queue item ready to pass to processWorkItems
 */
function buildFailedUpdateItem(workItemID: number): WorkItemUpdateQueueItem {
  return {
    update: {
      workItemID,
      status: WorkItemStatus.FAILED,
      message: 'it broke',
      message_category: 'noretry',
      duration: 1000,
    },
    preprocessResult: {
      status: WorkItemStatus.FAILED,
      catalogItems: [],
      outputItemSizes: [],
    },
  };
}

describe('processWorkItems with a multi-item batch for the same job and step', function () {
  // This exercises the path taken when the work-updater receives several queued updates for the
  // same (job, workflowStepIndex) in one poll cycle, which is the scenario the per-batch
  // nextWorkflowStep caching and the removal of the redundant trailing job.save() were designed
  // for. None of the HTTP-driven integration tests exercise a real multi-item batch, since the
  // in-memory test queue drains and processes each queued update immediately as it is sent, so
  // this test calls processWorkItems directly with a hand-built batch of several items.

  describe('when all items in the batch succeed and the next step is not aggregating', async function () {
    let job: Job;
    const items: WorkItemUpdateQueueItem[] = [];

    before(truncateAll);
    after(truncateAll);
    before(async function () {
      job = await rawSaveJob(db, {
        jobID: 'batch-success-job', username: 'joe', status: JobStatus.RUNNING,
        isAsync: true, numInputGranules: 3, ignoreErrors: false, collectionIds: [],
        request: 'http://example.com', message: 'in progress', createdAt: new Date(), updatedAt: new Date(),
      });
      await rawSaveWorkflowStep(db, {
        jobID: job.jobID, serviceID: 'svc1', stepIndex: 1, workItemCount: 3,
        hasAggregatedOutput: false, isBatched: false,
      });
      await rawSaveWorkflowStep(db, {
        jobID: job.jobID, serviceID: 'svc2', stepIndex: 2, workItemCount: 0,
        hasAggregatedOutput: false, isBatched: false,
      });
      const startedAt = new Date(Date.now() - 5000);
      for (let i = 0; i < 3; i++) {
        const workItem = await rawSaveWorkItem(db, {
          jobID: job.jobID, serviceID: 'svc1', workflowStepIndex: 1,
          status: WorkItemStatus.RUNNING, startedAt,
        });
        items.push(buildSuccessfulUpdateItem(workItem.id));
      }
      await populateUserWorkFromWorkItems(db);

      await processWorkItems(job.jobID, 1, items, logger);
    });

    it('marks every item in the batch successful', async function () {
      const { workItems } = await getWorkItemsByJobIdAndStepIndex(db, job.jobID, 1);
      expect(workItems.every((wi) => wi.status === WorkItemStatus.SUCCESSFUL)).to.be.true;
    });

    it('increments completed_work_item_count by the full batch size, not just the last item', async function () {
      const step1 = await getWorkflowStepByJobIdStepIndex(db, job.jobID, 1);
      expect(step1.completed_work_item_count).to.equal(3);
    });

    it('accumulates workItemCount on the shared next-step object across every item in the batch', async function () {
      // if the cached nextWorkflowStep were not correctly shared and mutated across items, this
      // would end up as 1 (only the last item's increment surviving) instead of 3
      const step2 = await getWorkflowStepByJobIdStepIndex(db, job.jobID, 2);
      expect(step2.workItemCount).to.equal(3);
    });

    it('creates one downstream work item per item in the batch', async function () {
      const { workItems: nextWorkItems } = await getWorkItemsByJobIdAndStepIndex(db, job.jobID, 2);
      expect(nextWorkItems.length).to.equal(3);
      expect(nextWorkItems.every((wi) => wi.status === WorkItemStatus.READY)).to.be.true;
    });

    it('updates job progress to reflect the completed step, persisted despite removing the trailing job.save', async function () {
      const { job: savedJob } = await Job.byJobID(db, job.jobID);
      expect(savedJob.progress).to.be.greaterThan(0);
    });

    it('leaves the job running since there is still a next step with new work', async function () {
      const { job: savedJob } = await Job.byJobID(db, job.jobID);
      expect(savedJob.status).to.equal(JobStatus.RUNNING);
    });
  });

  describe('when one item in the batch fails (with ignoreErrors) and the job continues', async function () {
    let job: Job;
    let items: WorkItemUpdateQueueItem[];
    let successWorkItemIds: number[];

    before(truncateAll);
    after(truncateAll);
    before(async function () {
      job = await rawSaveJob(db, {
        jobID: 'batch-mixed-job', username: 'joe', status: JobStatus.RUNNING,
        isAsync: true, numInputGranules: 3, ignoreErrors: true, collectionIds: [],
        request: 'http://example.com', message: 'in progress', createdAt: new Date(), updatedAt: new Date(),
      });
      await rawSaveWorkflowStep(db, {
        jobID: job.jobID, serviceID: 'svc1', stepIndex: 1, workItemCount: 3,
        hasAggregatedOutput: false, isBatched: false,
      });
      await rawSaveWorkflowStep(db, {
        jobID: job.jobID, serviceID: 'svc2', stepIndex: 2, workItemCount: 0,
        hasAggregatedOutput: false, isBatched: false,
      });
      const startedAt = new Date(Date.now() - 5000);
      const workItemIds = [];
      for (let i = 0; i < 3; i++) {
        const workItem = await rawSaveWorkItem(db, {
          jobID: job.jobID, serviceID: 'svc1', workflowStepIndex: 1,
          status: WorkItemStatus.RUNNING, startedAt,
        });
        workItemIds.push(workItem.id);
      }
      successWorkItemIds = [workItemIds[0], workItemIds[2]];
      await populateUserWorkFromWorkItems(db);

      // the middle item in the batch fails; the first and last succeed
      items = [
        buildSuccessfulUpdateItem(workItemIds[0]),
        buildFailedUpdateItem(workItemIds[1]),
        buildSuccessfulUpdateItem(workItemIds[2]),
      ];

      await processWorkItems(job.jobID, 1, items, logger);
    });

    it('marks the failing item failed and the others successful', async function () {
      const { workItems } = await getWorkItemsByJobIdAndStepIndex(db, job.jobID, 1);
      const byId = new Map(workItems.map((wi) => [wi.id, wi.status]));
      expect(byId.get(items[1].update.workItemID)).to.equal(WorkItemStatus.FAILED);
      for (const id of successWorkItemIds) {
        expect(byId.get(id)).to.equal(WorkItemStatus.SUCCESSFUL);
      }
    });

    it('persists the running_with_errors status set mid-batch through to the end of the batch', async function () {
      // this is exactly the case the removed trailing job.save() could have silently undone if
      // something between it and the end of the function needed that save to stick
      const { job: savedJob } = await Job.byJobID(db, job.jobID);
      expect(savedJob.status).to.equal(JobStatus.RUNNING_WITH_ERRORS);
    });

    it('only creates downstream work items for the items that succeeded', async function () {
      const step2 = await getWorkflowStepByJobIdStepIndex(db, job.jobID, 2);
      expect(step2.workItemCount).to.equal(2);
      const { workItems: nextWorkItems } = await getWorkItemsByJobIdAndStepIndex(db, job.jobID, 2);
      expect(nextWorkItems.length).to.equal(2);
    });
  });
});
