import { describe, it } from 'mocha';
import { expect } from 'chai';
import { JobRecord } from 'models/job';
import { WorkItemRecord, WorkItemStatus, getWorkItemById } from 'models/work-item';
import { v4 as uuid } from 'uuid';
import hookServersStartStop from './helpers/servers';
import db from '../app/util/db';
import { hookJobCreationEach } from './helpers/jobs';
import { hookWorkItemCreationEach, hookWorkItemUpdateEach } from './helpers/work-items';

describe('Work Backends', function () {
  const requestId = uuid().toString();
  const jobRecord = { jobID: requestId, requestId } as Partial<JobRecord>;
  const workItemRecord = {
    jobID: jobRecord.jobID,
    serviceID: 'harmonyservices/query-cmr',
  } as Partial<WorkItemRecord>;

  hookServersStartStop({ skipEarthdataLogin: true });
  hookJobCreationEach(jobRecord);

  describe('getting a work item', function () {
    describe('when a work item is not available', function () {

    });

    describe('when a work item is available', function () {

    });
  });

  describe('updating a work item', function () {
    describe('and the work item failed', async function () {
      const failedWorkItemRecord = {
        ...workItemRecord, ...{ id: 1, status: WorkItemStatus.FAILED },
      };

      hookWorkItemCreationEach(workItemRecord);
      hookWorkItemUpdateEach((r) => r.send(failedWorkItemRecord));
      it('the work item status is set to failed', async function () {
        const updatedWorkItem = await getWorkItemById(db, 1);
        expect(updatedWorkItem.status).to.equal(WorkItemStatus.FAILED);
      });
    });
  });
});
