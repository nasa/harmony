/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import sinon from 'sinon';

import { getDashboard } from '../app/frontends/dashboard';
import * as userWork from '../app/models/user-work';
import { WorkItemQueueType } from '../app/util/queue/queue';
import * as qf from '../app/util/queue/queue-factory';
import * as serviceImages from '../app/util/service-images';

describe('getDashboard', () => {
  const sandbox = sinon.createSandbox();
  let req: any;
  let res: any;
  let next: sinon.SinonSpy;
  let getCountsByServiceStub: sinon.SinonStub;
  let imageMapStub: sinon.SinonStub;

  beforeEach(() => {
    req = {
      user: 'test-user',
      context: { logger: { info: sandbox.stub(), error: sandbox.stub() } },
      accepts: sandbox.stub().returns('json'),
      query: {},
    };

    res = {
      json: sandbox.stub(),
      render: sandbox.stub(),
    };

    next = sandbox.spy();

    getCountsByServiceStub = sandbox.stub(userWork, 'getCountsByService');

    imageMapStub = sandbox.stub(serviceImages, 'getImageToServiceMap').returns({
      'podaac/l2ss-py': 'podaac-l2-subsetter',
      'harmony/query-cmr': 'query-cmr',
      'harmony/harmony-service-example': 'harmony-service-example',
    });

    const schedulerQueue = qf.getWorkSchedulerQueue();
    const smallUpdateQueue = qf.getQueueForType(WorkItemQueueType.SMALL_ITEM_UPDATE);
    const largeUpdateQueue = qf.getQueueForType(WorkItemQueueType.LARGE_ITEM_UPDATE);

    sandbox.stub(schedulerQueue, 'getApproximateNumberOfMessages').resolves(10);
    sandbox.stub(smallUpdateQueue, 'getApproximateNumberOfMessages').resolves(20);
    sandbox.stub(largeUpdateQueue, 'getApproximateNumberOfMessages').resolves(30);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('version validation', () => {
    it('succeeds when a valid version (1-alpha) is provided', async () => {
      req.query.version = '1-alpha';
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      expect(next.called).to.be.false;
      expect(res.json.calledOnce).to.be.true;
    });

    it('is case-insensitive when validating the version parameter', async () => {
      req.query.version = '1-ALPHA';
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      expect(next.called).to.be.false;
      expect(res.json.calledOnce).to.be.true;
    });

    it('calls next with an error when an unsupported version is provided', async () => {
      req.query.version = '2.0-beta';
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      const error = next.firstCall.args[0];
      expect(error.message).to.include('Invalid API version');
      expect(res.json.called).to.be.false;
    });
  });

  describe('data mapping and response', () => {
    it('returns all services sorted alphabetically with version', async () => {
      getCountsByServiceStub.resolves({
        'ghcr.io/podaac/l2ss-py:3.1.0rc4': { queued: 110000 },
      });

      await getDashboard(req, res, next);

      expect(res.json.calledOnce).to.be.true;
      const result = res.json.firstCall.args[0];

      expect(result.version).to.equal('1-alpha');
      expect(Object.keys(result.services)).to.deep.equal([
        'harmony-service-example',
        'podaac-l2-subsetter',
        'query-cmr',
      ]);
    });

    it('maps image names to service names and sums queued counts', async () => {
      getCountsByServiceStub.resolves({
        'ghcr.io/podaac/l2ss-py:3.1.0rc4': { queued: 110000 },
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['podaac-l2-subsetter'].queued).to.equal(110000);
    });

    it('fills in zero queued for services not present in DB results', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['harmony-service-example'].queued).to.equal(0);
      expect(services['query-cmr'].queued).to.equal(0);
      expect(services['podaac-l2-subsetter'].queued).to.equal(0);
    });

    it('includes all services from imageToServiceMap even when DB is empty', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(Object.keys(services)).to.have.members([
        'harmony-service-example',
        'podaac-l2-subsetter',
        'query-cmr',
      ]);
    });

    it('aggregates queued counts when multiple images map to the same service', async () => {
      imageMapStub.returns({
        'ghcr.io/podaac/l2ss-py:3.1.0rc4': 'podaac/l2ss-py',
        'ghcr.io/podaac/l2ss-py:3.0.0': 'podaac/l2ss-py',
        'ghcr.io/harmony/query-cmr:latest': 'query-cmr',
      });

      getCountsByServiceStub.resolves({
        'ghcr.io/podaac/l2ss-py:3.1.0rc4': { queued: 60000 },
        'ghcr.io/podaac/l2ss-py:3.0.0': { queued: 50000 },
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['podaac/l2ss-py'].queued).to.equal(110000);
    });

    it('includes unknown images from DB that are not in imageToServiceMap', async () => {
      imageMapStub.returns({
        'ghcr.io/harmony/query-cmr:latest': 'query-cmr',
      });

      getCountsByServiceStub.resolves({
        'ghcr.io/some-old-image:deprecated': { queued: 5 },
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['some-old-image']).to.deep.equal({ queued: 5 });
    });

    it('responds with JSON when client accepts JSON', async () => {
      req.accepts.returns('json');
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      expect(res.json.calledOnce).to.be.true;
    });

    it('responds with HTML when client requests HTML', async () => {
      req.accepts.returns('html');
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      expect(res.render.calledOnce).to.be.true;
      expect(res.json.called).to.be.false;
    });

    it('logs the requesting user', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      expect(req.context.logger.info.calledOnce).to.be.true;
      expect(req.context.logger.info.firstCall.args[0]).to.include('test-user');
    });

    it('calls next(err) when getCountsByService rejects', async () => {
      const error = new Error('DB connection failed');
      getCountsByServiceStub.rejects(error);

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.equal(error);
    });

    it('does not call res.json when an error occurs', async () => {
      getCountsByServiceStub.rejects(new Error('oops'));

      await getDashboard(req, res, next);

      expect(res.json.called).to.be.false;
    });
  });

  describe('system queue metrics', () => {
    it('includes the correct queue counts in the response', async () => {
      getCountsByServiceStub.resolves({});
      await getDashboard(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.queues.workItemScheduler).to.equal(10);
      expect(result.queues.smallWorkItemUpdates).to.equal(20);
    });
  });

  describe('HTML response', () => {
    beforeEach(() => {
      req.accepts.returns('html');
      getCountsByServiceStub.resolves({});
    });

    it('calls res.render with "dashboard" when HTML is requested', async () => {
      await getDashboard(req, res, next);

      expect(res.render.calledOnce).to.be.true;
      expect(res.render.firstCall.args[0]).to.equal('dashboard');
    });

    it('transforms service metrics into an array sorted by queued count (descending)', async () => {
      getCountsByServiceStub.resolves({
        'low-service': { queued: 5 },
        'high-service': { queued: 100 },
      });
      // Mock mapping so we don't rely on real image logic
      imageMapStub.returns({ 'low-service': 'low-service', 'high-service': 'high-service' });

      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      expect(data.services).to.be.an('array');
      expect(data.services[0].name).to.equal('high-service');
      expect(data.services[0].queued).to.equal(100);
    });

    it('transforms camelCase queue names into Title Case for the UI', async () => {
      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      const smallUpdateQueue = data.queues.find(q => q.name === 'Small Work Item Updates');
      expect(smallUpdateQueue).to.exist;
      expect(smallUpdateQueue.count).to.be.a('number');
    });

    it('includes the harmony version in the rendered view', async () => {
      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      expect(data.version).to.exist;
    });

    it('sets isFailed to true when a queue count is -1 (error state)', async () => {
      const schedulerQueue = qf.getWorkSchedulerQueue();
      (schedulerQueue.getApproximateNumberOfMessages as sinon.SinonStub).resolves(-1);

      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      const schedulerData = data.queues.find((q: any) => q.name === 'Work Item Scheduler');

      expect(schedulerData.isFailed).to.be.true;
      expect(schedulerData.count).to.equal(-1);
    });

    it('sets isFailed to false when a queue count is valid', async () => {
      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      const smallUpdateData = data.queues.find((q: any) => q.name === 'Small Work Item Updates');

      expect(smallUpdateData.isFailed).to.be.false;
      expect(smallUpdateData.count).to.equal(20);
    });

    it('sorts the services array by queued count descending for the initial view', async () => {
      getCountsByServiceStub.resolves({
        'service-a': { queued: 19 },
        'service-b': { queued: 1000 },
        'service-c': { queued: 500 },
      });
      imageMapStub.returns({
        'service-a': 'service-a',
        'service-b': 'service-b',
        'service-c': 'service-c',
      });

      await getDashboard(req, res, next);

      const { services } = res.render.firstCall.args[1];

      // Verify order: 1000 -> 500 -> 19
      expect(services[0].name).to.equal('service-b');
      expect(services[1].name).to.equal('service-c');
      expect(services[2].name).to.equal('service-a');
    });
  });
});
