import { describe, it } from 'mocha';
import { expect } from 'chai';
import { Job, JobRecord } from '../../app/models/job';
import { WorkItemRecord } from '../../app/models/work-item-interface';
import hookServersStartStop from '../helpers/servers';
import db from '../../app/util/db';
import { getWorkForService, makePartialWorkItemRecord, rawSaveWorkItem } from '../helpers/work-items';
import { makePartialJobRecord, rawSaveJob } from '../helpers/jobs';
import { makePartialWorkflowStepRecord, rawSaveWorkflowStep } from '../helpers/workflow-steps';
import { truncateAll } from '../helpers/db';

const jobData = [
  // jobID, username, status, isAsync, updatedAt
  //
  // Bob's oldest job
  ['job1', 'Bob', 'accepted', true, 12345],
  // Bob's most recent job
  ['job2', 'Bob', 'accepted', true, 12352],
  // this next job for Bob is more recent than job 1, but it is synchronous so it
  // should get selected before job 1
  ['job3', 'Bob', 'accepted', false, 12346],
  // Joe has waited the longest for work and this is his oldest job, so one of its work
  // items should be the first returned
  ['job4', 'Joe', 'running', true, 12345],
  // Joe's most recent job
  ['job5', 'Joe', 'accepted', true, 12350],
  ['job6', 'Bill', 'running', true, 12347],
  ['job7', 'Bill', 'accepted', true, 12348],
  // Bill's most recent job - this job is done so it should not have its work items returned
  ['job8', 'Bill', 'successful', true, 12355],
  // this job is not for the 'foo' service so it should not have its work items returned
  ['job9', 'John', 'accepted', true, 12340],
  // this job has been canceled so even a work item with a ready status should be ignored
  ['job10', 'Jane', 'canceled', true, 12200],
];

const workflowStepData = [
  // jobID, serviceID, operation
  ['job1', 'foo', '[]'],
  ['job2', 'bar', '[]'],
  ['job3', 'foo', '[]'],
  ['job4', 'foo', '[]'],
  ['job5', 'bar', '[]'],
  ['job6', 'foo', '[]'],
  ['job7', 'foo', '[]'],
  ['job8', 'foo', '[]'],
  ['job9', 'bar', '[]'],
  ['job10', 'foo', '[]'],
];

const workItemData = [
  // jobID, serviceID, status, updatedAt
  ['job1', 'foo', 'ready', 12345],
  ['job2', 'bar', 'ready', 12352],
  ['job3', 'foo', 'ready', 12347],
  ['job4', 'foo', 'ready', 12345],
  ['job5', 'bar', 'ready', 12350],
  ['job6', 'foo', 'ready', 12348],
  ['job7', 'foo', 'ready', 12349],
  ['job8', 'foo', 'successful', 12355],
  ['job9', 'bar', 'ready', 12340],
  ['job10', 'foo', 'ready', 12200],
];

describe('Fair Queueing', function () {
  const jobRecords = jobData.map(makePartialJobRecord);
  const workflowStepRecords = workflowStepData.map(makePartialWorkflowStepRecord);
  const workItemRecords = workItemData.map(makePartialWorkItemRecord);

  hookServersStartStop({ skipEarthdataLogin: true });

  before(truncateAll);
  after(truncateAll);

  describe('When work is requested for a service', function () {
    const results = [];
    before(async function () {
      await Promise.all(jobRecords.map(async (rec: Partial<JobRecord>) => {
        await rawSaveJob(db, rec);
      }));
      await Promise.all(workflowStepRecords.map(async (rec: Partial<JobRecord>) => {
        await rawSaveWorkflowStep(db, rec);
      }));
      await Promise.all(workItemRecords.map(async (rec: WorkItemRecord) => {
        await rawSaveWorkItem(db, rec);
      }));

      // ask for work for the 'foo' service six times
      for (let count = 0; count < 6; count++) {
        const result = await getWorkForService(this.backend, 'foo');
        results.push(result);
      }
    });

    describe('and one user has waited longer than other users to have work done', async function () {
      it('returns the work item for the oldest worked job for that user', async function () {
        expect(results[0].body.jobID).to.equal('job4');
      });
      it('updates the updatedAt field on the job', async function () {
        const job4 = await Job.byJobID(db, 'job4');
        expect(job4.updatedAt).to.be.greaterThan(new Date(jobData[3][4] as number));
      });
      it('returns work items for synchronous jobs ahead of older asynchronous jobs', async function () {
        expect(results[1].body.jobID).to.equal('job3');
      });
      it('returns the rest of the work items in fair queueing order', function () {
        const jobIds = results.slice(2, 5).map((result) => result.body.jobID);
        expect(jobIds).to.eql(['job6', 'job1', 'job7']);
      });
      it('returns a 404 status when no work is available', function () {
        expect(results[5].status).to.equal(404);
      });
    });
  });
});
