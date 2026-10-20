import { expect } from 'chai';
import { describe, it } from 'mocha';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import { JobRecord } from '../../app/models/job';
import UserWork, { populateUserWorkFromWorkItems } from '../../app/models/user-work';
import { WorkItemRecord } from '../../app/models/work-item-interface';
import db from '../../app/util/db';
import { makePartialJobRecord, rawSaveJob } from '../helpers/jobs';
import { setTestServicePodCount } from '../helpers/queue';
import hookServersStartStop from '../helpers/servers';
import { getWorkForService, makePartialWorkItemRecord, rawSaveWorkItem } from '../helpers/work-items';
import { makePartialWorkflowStepRecord, rawSaveWorkflowStep } from '../helpers/workflow-steps';

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
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

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

  describe('When the fast lane reserve capacity has been reached for a service', async function () {
    // SlowUser's two running slow work items exceed the slow work capacity (1) of the simulated
    // 2-pod 'foo' service, so only "fast" work - a measured fast job, and a never-before-attempted
    // job that gets a chance to be measured - should be eligible. A job already measured as slow
    // should not.
    const jobData2 = [
      // jobID, username, status, isAsync, updatedAt
      ['slowJob', 'SlowUser', 'running', true, 10000],
      ['fastJob', 'FastUser', 'accepted', true, 10001],
      ['newJob', 'NewUser', 'accepted', true, 10002],
      ['knownSlowJob', 'KnownSlowUser', 'accepted', true, 10003],
    ];

    const workflowStepData2 = [
      ['slowJob', 'foo', '[]'],
      ['fastJob', 'foo', '[]'],
      ['newJob', 'foo', '[]'],
      ['knownSlowJob', 'foo', '[]'],
    ];

    const workItemData2 = [
      // jobID, serviceID, status, updatedAt
      ['slowJob', 'foo', 'running', 10000],
      ['slowJob', 'foo', 'running', 10000],
      ['fastJob', 'foo', 'ready', 10001],
      ['newJob', 'foo', 'ready', 10002],
      ['knownSlowJob', 'foo', 'ready', 10003],
    ];

    const jobRecords = jobData2.map(makePartialJobRecord);
    const workflowStepRecords = workflowStepData2.map(makePartialWorkflowStepRecord);
    const workItemRecords = workItemData2.map(makePartialWorkItemRecord);

    before(truncateAll);
    after(truncateAll);
    after(() => setTestServicePodCount());
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

      // mark slowJob and knownSlowJob as already measured to be slower than the threshold;
      // fastJob is measured as fast; newJob is left unmeasured (average_duration null,
      // completed_count 0) to exercise the "give new work a chance to be measured" exception
      await db(UserWork.table).where({ job_id: 'slowJob' }).update({ average_duration: 700000, completed_count: 1 });
      await db(UserWork.table).where({ job_id: 'knownSlowJob' }).update({ average_duration: 700000, completed_count: 1 });
      await db(UserWork.table).where({ job_id: 'fastJob' }).update({ average_duration: 1000, completed_count: 1 });

      // simulate a 2-pod capacity for the 'foo' service so that SlowUser's 2 running items
      // saturate it and trigger the fast lane reserve
      setTestServicePodCount(2);

      for (let count = 0; count < 3; count++) {
        const result = await getWorkForService(this.backend, 'foo');
        results.push(result);
      }
    });

    it('returns the measured fast job before the never-before-attempted job', function () {
      expect(results[0].body.workItem.jobID).to.equal('fastJob');
    });

    it('returns the never-before-attempted job next, giving it a chance to be measured', function () {
      expect(results[1].body.workItem.jobID).to.equal('newJob');
    });

    it('does not return the job already measured as slow, even though it still has ready work', function () {
      expect(results[2].status).to.equal(404);
    });
  });

  /**
   * Saves jobs, workflow steps, and work items for a 10-pod 'foo' service where BusyFastUser
   * has `fastRunning` fast work items running, BusySlowUser has `slowRunning` slow work items
   * running, and IdleSlowUser and IdleFastUser each have one job with a ready work item.
   *
   * @param fastRunning - the number of running work items for the fast job
   * @param slowRunning - the number of running work items for the slow job
   */
  async function saveBusyServiceData(fastRunning: number, slowRunning: number): Promise<void> {
    const jobs = [
      ['busyFastJob', 'BusyFastUser', 'running', true, 20000],
      ['busySlowJob', 'BusySlowUser', 'running', true, 20001],
      ['idleSlowJob', 'IdleSlowUser', 'running', true, 20002],
      ['idleFastJob', 'IdleFastUser', 'running', true, 20003],
    ];
    const items = [
      ...Array.from({ length: fastRunning }, () => ['busyFastJob', 'foo', 'running', 20000]),
      ...Array.from({ length: slowRunning }, () => ['busySlowJob', 'foo', 'running', 20001]),
      ['idleSlowJob', 'foo', 'ready', 20002],
      ['idleFastJob', 'foo', 'ready', 20003],
    ];
    await Promise.all(jobs.map(makePartialJobRecord).map(async (rec: Partial<JobRecord>) => {
      await rawSaveJob(db, rec);
    }));
    await Promise.all(jobs.map(([jobID]) => [jobID, 'foo', '[]']).map(makePartialWorkflowStepRecord)
      .map(async (rec: Partial<JobRecord>) => {
        await rawSaveWorkflowStep(db, rec);
      }));
    await Promise.all(items.map(makePartialWorkItemRecord).map(async (rec: WorkItemRecord) => {
      await rawSaveWorkItem(db, rec);
    }));
    await populateUserWorkFromWorkItems(db);

    await db(UserWork.table).whereIn('job_id', ['busyFastJob', 'idleFastJob']).update({ average_duration: 1000, completed_count: 1 });
    await db(UserWork.table).whereIn('job_id', ['busySlowJob', 'idleSlowJob']).update({ average_duration: 700000, completed_count: 1 });

    // 10 pods with the default 30% fast lane reserve gives a slow work capacity of 7
    setTestServicePodCount(10);
  }

  describe('When a service is busy mostly with fast work and slow work is under its capacity', async function () {
    // 10 of 10 pods are busy, but only 2 with slow work - well under the slow work capacity of 7
    before(truncateAll);
    after(truncateAll);
    after(() => setTestServicePodCount());
    const results = [];
    before(async function () {
      await saveBusyServiceData(8, 2);
      for (let count = 0; count < 2; count++) {
        results.push(await getWorkForService(this.backend, 'foo'));
      }
    });

    it('returns the slow job first, prioritized by the normal fair queueing rules', function () {
      expect(results[0].body.workItem.jobID).to.equal('idleSlowJob');
    });

    it('returns the fast job next', function () {
      expect(results[1].body.workItem.jobID).to.equal('idleFastJob');
    });
  });

  describe('When running slow work has reached the slow work capacity for a service', async function () {
    // 7 of 10 pods are busy with slow work, reaching the slow work capacity of 7
    before(truncateAll);
    after(truncateAll);
    after(() => setTestServicePodCount());
    const results = [];
    before(async function () {
      await saveBusyServiceData(0, 7);
      for (let count = 0; count < 2; count++) {
        results.push(await getWorkForService(this.backend, 'foo'));
      }
    });

    it('returns the fast job', function () {
      expect(results[0].body.workItem.jobID).to.equal('idleFastJob');
    });

    it('does not return the slow job, even though it would otherwise be prioritized first', function () {
      expect(results[1].status).to.equal(404);
    });
  });
});
