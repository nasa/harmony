import { describe, it, beforeEach, afterEach, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import Sinon, { SinonStub } from 'sinon';
import { Job, JobRecord, JobStatus } from 'models/job';
import { HTTPError } from 'superagent';
import JobLink from 'models/job-link';
import WorkItem, { WorkItemRecord, WorkItemStatus, getWorkItemById } from 'models/work-item';
import { hookTransaction, truncateAll } from './helpers/db';
import hookServersStartStop from './helpers/servers';
import { rangesetRequest } from './helpers/ogc-api-coverages';
import { validGetMapQuery, wmsRequest } from './helpers/wms';
import db from '../app/util/db';
import { hookJobCreationEach } from './helpers/jobs';
import { getObjectText } from './helpers/object-store';
import { objectStoreForProtocol, S3ObjectStore } from '../app/util/object-store';
import { hookCallbackEach, hookHttpBackendEach, loadJobForCallback } from './helpers/callbacks';
import { hookWorkItemCreationEach, hookWorkItemUpdateEach } from './helpers/work-items';

describe('Work Backends', function () {
  const jobRecord = { jobID: '123' } as Partial<JobRecord>;
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
      // expect(1).to.equal(1);
      const failedWorkItemRecord = {
        ...workItemRecord, ...{ id: 1, status: WorkItemStatus.FAILED },
      };

      // hookTransaction();
      hookWorkItemCreationEach(workItemRecord);
      hookWorkItemUpdateEach((r) => r.send(failedWorkItemRecord));
      xit('the work item status is set to failed', async function () {
        const x = 4;
        console.log(x);
        expect(2).to.equal(2);
        const updatedWorkItem = await getWorkItemById(db, 1);
        // this.trx.commit();

        expect(updatedWorkItem.status).to.equal(WorkItemStatus.FAILED);
      });
    });
  });
});
