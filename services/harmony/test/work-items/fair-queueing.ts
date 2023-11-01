import { describe, it } from 'mocha';
import { expect } from 'chai';
import { JobRecord } from '../../app/models/job';
import { WorkItemRecord } from '../../app/models/work-item-interface';
import hookServersStartStop from '../helpers/servers';
import db from '../../app/util/db';
import { getWorkForService, makePartialWorkItemRecord, rawSaveWorkItem } from '../helpers/work-items';
import { makePartialJobRecord, rawSaveJob } from '../helpers/jobs';
import { makePartialWorkflowStepRecord, rawSaveWorkflowStep } from '../helpers/workflow-steps';
import { truncateAll } from '../helpers/db';
import { populateUserWorkFromWorkItems } from '../../app/models/user-work';

const jobData = [
  // jobID, username, status, isAsync, updatedAt
  //
  // Bob's oldest job
  ['bobOldest', 'Bob', 'accepted', true, 12345],
  // Bob's most recent job
  ['bobNewest', 'Bob', 'accepted', true, 12352],
  // this next job for Bob is more recent than job 1, but it is synchronous so it
  // should get selected before job 1
  ['bobSync', 'Bob', 'accepted', false, 12346],
  // Joe has waited the longest for work and this is his oldest job, so one of its work
  // items should be the first returned
  ['joeOldest', 'Joe', 'running', true, 12345],
  // Joe's most recent job
  ['joeNewest', 'Joe', 'accepted', true, 12350],
  ['billOldest', 'Bill', 'running', true, 12347],
  ['billMiddle', 'Bill', 'accepted', true, 12348],
  // The most recently worked on job
  ['billNewest', 'Bill', 'running', true, 12355],
  // this job is not for the 'foo' service so it should not have its work items returned
  ['johnOtherService', 'John', 'accepted', true, 12340],
  // this job has been canceled so even a work item with a ready status should be ignored
  ['janeCanceled', 'Jane', 'canceled', true, 12200],
];

const workflowStepData = [
  // jobID, serviceID, operation
  ['bobOldest', 'foo', '[]'],
  ['bobNewest', 'bar', '[]'],
  ['bobSync', 'foo', '[]'],
  ['joeOldest', 'foo', '[]'],
  ['joeNewest', 'bar', '[]'],
  ['billOldest', 'foo', '[]'],
  ['billMiddle', 'foo', '[]'],
  ['billNewest', 'foo', '[]'],
  ['johnOtherService', 'bar', '[]'],
  ['janeCanceled', 'foo', '[]'],
];

const workItemData = [
  // jobID, serviceID, status, updatedAt
  ['bobOldest', 'foo', 'ready', 12345],
  ['bobNewest', 'bar', 'ready', 12352],
  ['bobSync', 'foo', 'ready', 12347],
  ['joeOldest', 'foo', 'ready', 12345],
  ['joeNewest', 'bar', 'ready', 12350],
  ['billOldest', 'foo', 'ready', 12348],
  ['billMiddle', 'foo', 'ready', 12349],
  ['billNewest', 'foo', 'successful', 12355],
  ['johnOtherService', 'bar', 'ready', 12340],
  ['janeCanceled', 'foo', 'ready', 12200],
];

describe('Fair Queueing', function () {
  hookServersStartStop({ skipEarthdataLogin: true });

  describe('When work is requested for a service and no work items are currently running', function () {
    const jobRecords = jobData.map(makePartialJobRecord);
    const workflowStepRecords = workflowStepData.map(makePartialWorkflowStepRecord);
    const workItemRecords = workItemData.map(makePartialWorkItemRecord);

    before(truncateAll);
    after(truncateAll);
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

      await populateUserWorkFromWorkItems(db);

      // ask for work for the 'foo' service six times
      for (let count = 0; count < 6; count++) {
        const result = await getWorkForService(this.backend, 'foo');
        results.push(result);
      }
    });

    describe('and one user has waited longer than other users to have work done', async function () {
      it('returns the work item for the oldest worked job for that user', async function () {
        expect(results[0].body.workItem.jobID).to.equal('joeOldest');
      });
      it('returns work items for synchronous jobs ahead of older asynchronous jobs', async function () {
        expect(results[1].body.workItem.jobID).to.equal('bobSync');
      });
      it('returns the rest of the work items in fair queueing order', function () {
        const jobIds = results.slice(2, 5).map((result) => result.body.workItem?.jobID);
        expect(jobIds).to.eql(['billOldest', 'bobOldest', 'billMiddle']);
      });
      it('returns a 404 status when no work is available', function () {
        expect(results[5].status).to.equal(404);
      });
    });
  });

  describe('When work is requested for a service and there are work items currently running', async function () {
    // At the start of this test Joe has 3 items running, Bob has one item running, and Bill has zero.
    const additionalRunningWorkItemData = [
      // jobID, serviceID, status, updatedAt
      ['joeNewest', 'foo', 'running', 12345],
      ['joeNewest', 'bar', 'running', 12352],
      ['joeOldest', 'foo', 'running', 12347],
      ['bobSync', 'bar', 'running', 12350],
    ];
    const allWorkItemsData = workItemData.concat(additionalRunningWorkItemData);

    const jobRecords = jobData.map(makePartialJobRecord);
    const workflowStepRecords = workflowStepData.map(makePartialWorkflowStepRecord);
    const workItemRecords = allWorkItemsData.map(makePartialWorkItemRecord);
    before(truncateAll);
    after(truncateAll);
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

      await populateUserWorkFromWorkItems(db);

      // ask for work for the 'foo' service six times
      for (let count = 0; count < 6; count++) {
        const result = await getWorkForService(this.backend, 'foo');
        results.push(result);
      }
    });

    it('returns the work item for the user with the fewest currently running jobs regardless of when the user last had work complete', async function () {
      expect(results[0].body.workItem.jobID).to.equal('billOldest');
    });
    it('returns the work item for the user with the least recently worked job when two users have the same number of jobs running', async function () {
      expect(results[1].body.workItem.jobID).to.equal('bobSync');
    });

    it('returns the rest of the work items in fair queueing order', function () {
      const jobIds = results.slice(2, 5).map((result) => result.body.workItem?.jobID);
      expect(jobIds).to.eql(['billMiddle', 'bobOldest', 'joeOldest']);
    });
    it('returns a 404 status when no work is available', function () {
      expect(results[5].status).to.equal(404);
    });
  });
});
