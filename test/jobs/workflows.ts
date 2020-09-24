import { v4 as uuid } from 'uuid';
import { expect } from 'chai';
import _ from 'lodash';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { EventType } from 'app/workers/workflow-listener';
import WorkflowTerminationListener from 'app/workers/workflow-termination-listener';
import * as job from 'util/job';
import * as sinon from 'sinon';
import { hookTransaction } from '../helpers/db';
import { JobRecord, JobStatus, Job } from '../../app/models/job';
import { Workflow, getWorkflowsForJob, terminateWorkflows } from '../../app/util/workflows';
import * as uworkflows from '../../app/util/workflows';
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

const workflowTerminationEvent = {
  kind: 'Event',
  apiVersion: 'v1',
  metadata:
  {
    name: 'harmony-gdal-pgh5d.1633be7dd112af77',
    namespace: 'argo',
    selfLink: '/api/v1/namespaces/argo/events/harmony-gdal-pgh5d.1633be7dd112af77',
    uid: '704ddcdd-c437-4d28-bfcd-36981531d5e9',
    resourceVersion: '157675',
    creationTimestamp: '2020-09-11T13:42:20Z',
    managedFields: [[Object]],
  },
  involvedObject:
  {
    kind: 'Workflow',
    namespace: 'argo',
    name: 'harmony-gdal-pgh5d',
    uid: '3dec5f9e-fc96-48a1-be49-47ac11e81638',
    apiVersion: 'argoproj.io/v1alpha1',
    resourceVersion: '157661',
  },
  reason: 'WorkflowFailed',
  message: 'Stopped with strategy \'Terminate\'',
  source: { component: 'workflow-controller' },
  firstTimestamp: '2020-09-11T13:42:20Z',
  lastTimestamp: '2020-09-11T13:42:20Z',
  count: 1,
  type: 'Warning',
  eventTime: null,
  reportingComponent: '',
  reportingInstance: '',
};

const workflowRunningEvent = {
  kind: 'Event',
  apiVersion: 'v1',
  metadata:
  {
    name: 'harmony-gdal-pgh5d.1633be741105be56',
    namespace: 'argo',
    selfLink: '/api/v1/namespaces/argo/events/harmony-gdal-pgh5d.1633be741105be56',
    uid: 'd87fb386-96cb-433e-8d0f-4524483c1752',
    resourceVersion: '157644',
    creationTimestamp: '2020-09-11T13:41:38Z',
    managedFields: [[Object]],
  },
  involvedObject:
  {
    kind: 'Workflow',
    namespace: 'argo',
    name: 'harmony-gdal-pgh5d',
    uid: '3dec5f9e-fc96-48a1-be49-47ac11e81638',
    apiVersion: 'argoproj.io/v1alpha1',
    resourceVersion: '157643',
  },
  reason: 'WorkflowRunning',
  message: 'Workflow Running',
  source: { component: 'workflow-controller' },
  firstTimestamp: '2020-09-11T13:41:38Z',
  lastTimestamp: '2020-09-11T13:41:38Z',
  count: 1,
  type: 'Normal',
  eventTime: null,
  reportingComponent: '',
  reportingInstance: '',
};

const podEvent = {
  kind: 'Event',
  apiVersion: 'v1',
  metadata:
  {
    name: 'harmony-gdal-pgh5d-1059139216.1633be746f80882c',
    namespace: 'argo',
    selfLink: '/api/v1/namespaces/argo/events/harmony-gdal-pgh5d-1059139216.1633be746f80882c',
    uid: '1b6ae38a-ad6e-44a5-8479-6a46cc153722',
    resourceVersion: '157656',
    creationTimestamp: '2020-09-11T13:41:39Z',
    managedFields: [[Object]],
  },
  involvedObject:
  {
    kind: 'Pod',
    namespace: 'argo',
    name: 'harmony-gdal-pgh5d-1059139216',
    uid: '6f699c17-c8be-4fca-8864-07943917fb31',
    apiVersion: 'v1',
    resourceVersion: '157646',
    fieldPath: 'spec.containers{main}',
  },
  reason: 'Started',
  message: 'Started container main',
  source: { component: 'kubelet', host: 'minikube' },
  firstTimestamp: '2020-09-11T13:41:39Z',
  lastTimestamp: '2020-09-11T13:41:39Z',
  count: 1,
  type: 'Normal',
  eventTime: null,
  reportingComponent: '',
  reportingInstance: '',
};

describe('workflow termination listener gets a', async function () {
  let listener: WorkflowTerminationListener;
  let getWorkflowByNameStub: sinon.SinonStub;
  let cancelAndSaveJobStub: sinon.SinonStub;

  beforeEach(function () {
    listener = new WorkflowTerminationListener({ namespace: 'argo', logger: log });
    const workflow = { metadata: { labels: { request_id: 'foo' } } } as Workflow;
    getWorkflowByNameStub = sinon.stub(uworkflows, 'getWorkflowByName')
      .callsFake(async () => workflow);
    cancelAndSaveJobStub = sinon.stub(job, 'default')
      .callsFake(async () => { });
  });

  afterEach(function () {
    if (getWorkflowByNameStub.restore) getWorkflowByNameStub.restore();
    if (cancelAndSaveJobStub.restore) cancelAndSaveJobStub.restore();
  });

  describe('termination event', async function () {
    it('processes the event', async function () {
      expect(listener.shouldHandleEvent(EventType.ADDED, workflowTerminationEvent)).to.be.true;
    });

    it('and terminates the workflow', async function () {
      await listener.handleEvent(workflowRunningEvent);
      expect(getWorkflowByNameStub.callCount).to.equal(1);
      expect(cancelAndSaveJobStub.callCount).to.equal(1);
    });
  });

  describe('non-termination event', async function () {
    it('ignores the event', async function () {
      expect(listener.shouldHandleEvent(EventType.ADDED, workflowRunningEvent)).to.be.false;
    });
  });

  describe('pod event', async function () {
    it('ignores the event', async function () {
      expect(listener.shouldHandleEvent(EventType.ADDED, podEvent)).to.be.false;
    });
  });

  describe('MODIFIED type event', async function () {
    it('ignores the event', async function () {
      expect(listener.shouldHandleEvent(EventType.MODIFIED, workflowTerminationEvent)).to.be.false;
    });
  });

  describe('DELETED type event', async function () {
    it('ignores the event', async function () {
      expect(listener.shouldHandleEvent(EventType.DELETED, workflowTerminationEvent)).to.be.false;
    });
  });

  describe('BOOKMARK type event', async function () {
    it('ignores the event', async function () {
      expect(listener.shouldHandleEvent(EventType.BOOKMARK, workflowTerminationEvent)).to.be.false;
    });
  });
});
