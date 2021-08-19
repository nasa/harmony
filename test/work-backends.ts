import { describe, it } from 'mocha';
import { expect } from 'chai';
import { Job, JobRecord } from 'models/job';
import { WorkItemRecord, WorkItemStatus, getWorkItemById } from 'models/work-item';
import { v4 as uuid } from 'uuid';
import { JobStatus } from 'tasks/service-wrapper/built/app/models/job';
import { defaultContainerRegistry } from 'util/container-registry';
import { WorkflowStepRecord } from 'models/workflow-steps';
import hookServersStartStop from './helpers/servers';
import db from '../app/util/db';
import { hookJobCreation, hookJobCreationEach } from './helpers/jobs';
import { hookWorkItemCreation, hookWorkItemCreationEach, hookWorkItemUpdate, hookWorkItemUpdateEach } from './helpers/work-items';
import { hookWorkflowStepCreationEach } from './helpers/workflow-steps';

describe('Work Backends', function () {
  const requestId = uuid().toString();
  const jobRecord = { jobID: requestId, requestId } as Partial<JobRecord>;
  const service = 'harmonyservices/query-cmr';

  const workItemRecord = {
    jobID: jobRecord.jobID,
    serviceID: service,
  } as Partial<WorkItemRecord>;

  const workflowStepRecod = {
    jobID: jobRecord.jobID,
    serviceID: service,
  } as Partial<WorkflowStepRecord>;

  hookServersStartStop({ skipEarthdataLogin: true });
  hookJobCreationEach(jobRecord);
  // hookWorkflowStepCreationEach(workflowStepRecod);
  hookWorkItemCreationEach(workItemRecord);

  describe('getting a work item', function () {
    describe('when a work item is not available', function () {

    });

    describe('when a work item is available', function () {

    });
  });

  describe('updating a work item', function () {
    describe('and the work item failed', async function () {
      const failedWorkItemRecord = {
        ...workItemRecord, ...{ status: WorkItemStatus.FAILED },
      };

      hookWorkItemUpdateEach((r) => r.send(failedWorkItemRecord));

      it('the work item status is set to failed', async function () {
        const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
        expect(updatedWorkItem.status).to.equal(WorkItemStatus.FAILED);
      });
      it('the job status is set to failed', async function () {
        const job = await Job.byJobID(db, this.job.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
      });
    });

    describe('and the work item succeeded', async function () {
      const successfulWorkItemRecord = {
        ...workItemRecord,
        ...{
          status: WorkItemStatus.SUCCESSFUL,
          results: [],
        },
      };

      hookWorkItemUpdateEach((r) => r.send(successfulWorkItemRecord));

      xit('the work item status is set to successful', async function () {
        const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
        expect(updatedWorkItem.status).to.equal(WorkItemStatus.SUCCESSFUL);
      });
      describe('and the work item is the last in the chain', async function () {
        xit('the job updatedAt field is set to the current time', async function () {
          const updatedJob = await Job.byJobID(db, this.job.jobID);
          expect(updatedJob.updatedAt.valueOf()).to.greaterThan(this.job.updatedAt.valueOf());
        });
      });
    });
  });
});
