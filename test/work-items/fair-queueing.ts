import { describe, it } from 'mocha';
import { expect } from 'chai';
import { JobRecord } from '../../app/models/job';
import { WorkItemRecord } from '../../app/models/work-item';
import hookServersStartStop from '../helpers/servers';
import db from '../../app/util/db';
import { hookGetWorkForService, makePartialWorkItemRecord, rawSaveWorkItem } from '../helpers/work-items';
import { makePartialJobRecord, rawSaveJob } from '../helpers/jobs';
import { makePartialWorkflowStepRecord, rawSaveWorkflowStep } from '../helpers/workflow-steps';
import { truncateAll } from '../helpers/db';

const jobData = [
  // jobID, username, status, isAsync, updatedAt
  ['job1', 'Bob', 'accepted', true, 12345],
  ['job2', 'Bob', 'accepted', true, 12352],
  // this next job for Bob is more recent than job 1, but it is synchronous so it
  // should get selected before job 1
  ['job3', 'Bob', 'accepted', false, 12346],
  // Joe has waited the longest for work and this is his oldest job, so one it its work
  // items should be the first returned
  ['job4', 'Joe', 'running', true, 12345],
  ['job5', 'Joe', 'accepted', true, 12350],
  ['job6', 'Bill', 'running', true, 12347],
  ['job7', 'Bill', 'accepted', true, 12348],
  ['job8', 'Bill', 'successful', true, 12355],
  ['job8', 'John', 'accepted', true, 12340],
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
];

describe('Fair Queueing', function () {

  const jobRecords = jobData.map(makePartialJobRecord);
  const workflowStepRecords = workflowStepData.map(makePartialWorkflowStepRecord);
  const workItemRecords = workItemData.map(makePartialWorkItemRecord);

  hookServersStartStop({ skipEarthdataLogin: true });

  describe('when getting a work item', function () {

    before(async () => {
      await Promise.all(jobRecords.map(async (rec: Partial<JobRecord>) => {
        await rawSaveJob(db, rec);
      }));
      await Promise.all(workflowStepRecords.map(async (rec: Partial<JobRecord>) => {
        await rawSaveWorkflowStep(db, rec);
      }));
      await Promise.all(workItemRecords.map(async (rec: WorkItemRecord) => {
        await rawSaveWorkItem(db, rec);
      }));
    });

    after(truncateAll);

    describe('when one user has waited longer than other users to have work done', async function () {
      hookGetWorkForService('foo', beforeEach, afterEach);

      it('returns the work item for the oldest worked job for that user', async function () {
        expect(this.res.body.jobID).to.equal('job4');
      });
      it('returns work items for synchronous jobs ahead of older asynchronous jobs', async function () {
        expect(this.res.body.jobID).to.equal('job3');
      });
    });
  });
});
