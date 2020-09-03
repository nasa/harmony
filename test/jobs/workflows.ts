import { v4 as uuid } from 'uuid';
import { expect } from 'chai';
import _ from 'lodash';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { hookTransaction } from '../helpers/db';
import { JobRecord, JobStatus, Job } from '../../app/models/job';
import { Workflow, getWorkflowsForJob, terminateWorkflows } from '../../app/util/workflows';
import log from '../../app/util/log';

const singleWorkflowJobRecord: JobRecord = {
  username: 'joe',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  links: [
    {
      href: 'http://example.com',
      rel: 'link',
      type: 'text/plain',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    }],
  request: 'http://example.com/harmony?job=singleWorkflowJob',
};

const multipleWorkflowJobRecord: JobRecord = {
  username: 'joe',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  links: [
    {
      href: 'http://example.com',
      rel: 'link',
      type: 'text/plain',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    }],
  request: 'http://example.com/harmony?job=multipleWorkflowJob',
};

// single workflow per job - normally this would be the only case
const singleWorkflowListResponse = {
  items: [
    {
      metadata: {
        name: 'foo',
      },
    },
  ],
};

// multiple workflows for a job - adding this in case we allow this later
const multipleWorkflowListResponse = {
  items: [
    {
      metadata: {
        name: 'foo1',
      },
    },
    {
      metadata: {
        name: 'foo2',
      },
    },
  ],
};

describe('Terminating job workflow(s)', async function () {
  hookTransaction();
  let singleWorkflowJob: Job;
  let multipleWorkflowJob: Job;

  before(async function () {
    singleWorkflowJob = new Job(singleWorkflowJobRecord);
    await singleWorkflowJob.save(this.trx);
    multipleWorkflowJob = new Job(multipleWorkflowJobRecord);
    await multipleWorkflowJob.save(this.trx);
    this.trx.commit();
    this.trx = null;
  });

  describe('single workflow', async function () {
    it('makes one get and one put call to argo', async function () {
      const mock = new MockAdapter(axios);
      mock.onGet().reply(function (_config) {
        return [200, singleWorkflowListResponse];
      });
      mock.onPut().reply(200, 'OK');
      await terminateWorkflows(singleWorkflowJob, log);
      expect(mock.history.get.length).to.equal(1);
      expect(mock.history.put.length).to.equal(1);
      mock.restore();
    });
  });

  describe('multiple workflows', async function () {
    it('makes one get and multiple put calls to argo', async function () {
      const mock = new MockAdapter(axios);
      mock.onGet().reply(function (_config) {
        return [200, multipleWorkflowListResponse];
      });
      mock.onPut().reply(200, 'OK');
      await terminateWorkflows(multipleWorkflowJob, log);
      expect(mock.history.get.length).to.equal(1);
      expect(mock.history.put.length).to.equal(2);
      mock.restore();
    });
  });
});

describe('Getting job workflows', async function () {
  hookTransaction();

  let singleWorkflowJob: Job;
  let multipleWorkflowJob: Job;

  before(async function () {
    singleWorkflowJob = new Job(singleWorkflowJobRecord);
    await singleWorkflowJob.save(this.trx);
    multipleWorkflowJob = new Job(multipleWorkflowJobRecord);
    await multipleWorkflowJob.save(this.trx);
    this.trx.commit();
    this.trx = null;
  });

  describe('single workflow', async function () {
    let mock: MockAdapter;
    let workflows: Workflow[];
    before(async function () {
      mock = new MockAdapter(axios);
      mock.onGet().reply(function (_config) {
        return [200, singleWorkflowListResponse];
      });
      workflows = await getWorkflowsForJob(singleWorkflowJob, log);
    });
    it('makes one get call to argo', async function () {
      expect(mock.history.get.length).to.equal(1);
      mock.restore();
    });

    it('returns one workflow', async function () {
      expect(workflows.length).to.equal(1);
    });
  });

  describe('multiple workflows', async function () {
    let mock: MockAdapter;
    let workflows: Workflow[];
    before(async function () {
      mock = new MockAdapter(axios);
      mock.onGet().reply(function (_config) {
        return [200, multipleWorkflowListResponse];
      });
      workflows = await getWorkflowsForJob(singleWorkflowJob, log);
    });
    it('makes one get call to argo', async function () {
      expect(mock.history.get.length).to.equal(1);
      mock.restore();
    });

    it('returns two workflows', async function () {
      expect(workflows.length).to.equal(2);
    });
  });
});
