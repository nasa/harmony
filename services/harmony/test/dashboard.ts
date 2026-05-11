/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import sinon from 'sinon';

import { getDashboard } from '../app/frontends/dashboard';
import * as userWork from '../app/models/user-work';
import * as workItemsStats from '../app/models/work-items-stats';
import { WorkItemQueueType } from '../app/util/queue/queue';
import * as qf from '../app/util/queue/queue-factory';
import * as serviceImages from '../app/util/service-images';

/**
 * Returns a fake getWorkItemsStatsSummary result with empty rows and fixed time boundaries.
 */
function makeEmptyStatsSummary(minutesAgo: number): { rows: never[]; start: Date; end: Date } {
  const end = new Date('2024-01-01T12:00:00.000Z');
  const start = new Date(end.getTime() - minutesAgo * 60 * 1000);
  return { rows: [], start, end };
}

/**
 * Returns a fake summary result with a single row of data.
 */
function makeStatsSummaryWithRows(
  minutesAgo: number,
  rows: workItemsStats.WorkItemsStatsRow[],
): workItemsStats.WorkItemsStatsSummary {
  const end = new Date('2024-01-01T12:00:00.000Z');
  const start = new Date(end.getTime() - minutesAgo * 60 * 1000);
  return { rows, start, end };
}

describe('getDashboard', () => {
  const sandbox = sinon.createSandbox();
  let req: any;
  let res: any;
  let next: sinon.SinonSpy;
  let getCountsByServiceStub: sinon.SinonStub;
  let getWorkItemsStatsSummaryStub: sinon.SinonStub;
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

    getWorkItemsStatsSummaryStub = sandbox.stub(workItemsStats, 'getWorkItemsStatsSummary');
    // Default: return empty stats for any minute window
    getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) =>
      Promise.resolve(makeEmptyStatsSummary(minutes)),
    );

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

  // ---------------------------------------------------------------------------
  // Version validation
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Data mapping and JSON response
  // ---------------------------------------------------------------------------

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
      expect(services['some-old-image'].queued).to.equal(5);
      expect(services['some-old-image'].recent).to.exist;
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

  // ---------------------------------------------------------------------------
  // Recent metrics (last5Minutes / last60Minutes per service)
  // ---------------------------------------------------------------------------

  describe('recent metrics', () => {
    it('includes last5Minutes and last60Minutes counts on each service', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      for (const service of Object.values(services) as any[]) {
        expect(service.recent).to.exist;
        expect(service.recent.last5Minutes).to.include.keys('successful', 'failed', 'canceled', 'warning');
        expect(service.recent.last60Minutes).to.include.keys('successful', 'failed', 'canceled', 'warning');
      }
    });

    it('defaults all recent counts to zero when stats summary returns no rows', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      const service = services['query-cmr'];
      expect(service.recent.last5Minutes).to.deep.equal({ successful: 0, failed: 0, canceled: 0, warning: 0 });
      expect(service.recent.last60Minutes).to.deep.equal({ successful: 0, failed: 0, canceled: 0, warning: 0 });
    });

    it('populates last5Minutes counts from the stats summary for the correct service', async () => {
      imageMapStub.returns({ 'podaac/l2ss-py': 'podaac-l2-subsetter' });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) => {
        if (minutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'podaac/l2ss-py', status: 'successful', count: 42 },
            { service_id: 'podaac/l2ss-py', status: 'failed', count: 3 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(minutes));
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['podaac-l2-subsetter'].recent.last5Minutes.successful).to.equal(42);
      expect(services['podaac-l2-subsetter'].recent.last5Minutes.failed).to.equal(3);
      expect(services['podaac-l2-subsetter'].recent.last5Minutes.canceled).to.equal(0);
      expect(services['podaac-l2-subsetter'].recent.last5Minutes.warning).to.equal(0);
    });

    it('populates last60Minutes counts independently from the 5-minute window', async () => {
      imageMapStub.returns({ 'podaac/l2ss-py': 'podaac-l2-subsetter' });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) => {
        if (minutes === 60) {
          return Promise.resolve(makeStatsSummaryWithRows(60, [
            { service_id: 'podaac/l2ss-py', status: 'successful', count: 500 },
            { service_id: 'podaac/l2ss-py', status: 'warning', count: 10 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(minutes));
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['podaac-l2-subsetter'].recent.last60Minutes.successful).to.equal(500);
      expect(services['podaac-l2-subsetter'].recent.last60Minutes.warning).to.equal(10);
      expect(services['podaac-l2-subsetter'].recent.last60Minutes.failed).to.equal(0);
    });

    it('aggregates recent counts when multiple rows share the same service and status', async () => {
      imageMapStub.returns({
        'image-a': 'shared-service',
        'image-b': 'shared-service',
      });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) => {
        if (minutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'image-a', status: 'successful', count: 10 },
            { service_id: 'image-b', status: 'successful', count: 20 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(minutes));
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['shared-service'].recent.last5Minutes.successful).to.equal(30);
    });

    it('ignores rows with untracked statuses in the stats summary', async () => {
      imageMapStub.returns({ 'some-image': 'some-service' });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) => {
        if (minutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'some-image', status: 'running', count: 99 },
            { service_id: 'some-image', status: 'successful', count: 5 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(minutes));
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      // 'running' is not a tracked status — only 'successful' should appear
      expect(services['some-service'].recent.last5Minutes.successful).to.equal(5);
      expect((services['some-service'].recent.last5Minutes as any).running).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // Time ranges
  // ---------------------------------------------------------------------------

  describe('timeRanges', () => {
    it('includes timeRanges with last5Minutes and last60Minutes keys in the JSON response', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.timeRanges).to.exist;
      expect(result.timeRanges.last5Minutes).to.include.keys('start', 'end');
      expect(result.timeRanges.last60Minutes).to.include.keys('start', 'end');
    });

    it('returns ISO string timestamps for each time range boundary', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const { timeRanges } = res.json.firstCall.args[0];
      expect(timeRanges.last5Minutes.start).to.match(/^\d{4}-\d{2}-\d{2}T/);
      expect(timeRanges.last5Minutes.end).to.match(/^\d{4}-\d{2}-\d{2}T/);
      expect(timeRanges.last60Minutes.start).to.match(/^\d{4}-\d{2}-\d{2}T/);
      expect(timeRanges.last60Minutes.end).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('derives time range boundaries from the values returned by getWorkItemsStatsSummary', async () => {
      getCountsByServiceStub.resolves({});
      const fixedEnd = new Date('2024-06-15T08:30:00.000Z');
      const fixedStart5 = new Date('2024-06-15T08:25:00.000Z');
      const fixedStart60 = new Date('2024-06-15T07:30:00.000Z');

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) => {
        if (minutes === 5) return Promise.resolve({ rows: [], start: fixedStart5, end: fixedEnd });
        return Promise.resolve({ rows: [], start: fixedStart60, end: fixedEnd });
      });

      await getDashboard(req, res, next);

      const { timeRanges } = res.json.firstCall.args[0];
      expect(timeRanges.last5Minutes.start).to.equal(fixedStart5.toISOString());
      expect(timeRanges.last5Minutes.end).to.equal(fixedEnd.toISOString());
      expect(timeRanges.last60Minutes.start).to.equal(fixedStart60.toISOString());
    });
  });

  // ---------------------------------------------------------------------------
  // Totals (system-wide aggregates)
  // ---------------------------------------------------------------------------

  describe('totals', () => {
    it('includes a totals key in the JSON response', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.totals).to.exist;
    });

    it('sums queued counts from all services into totals.queued', async () => {
      imageMapStub.returns({
        'service-a': 'service-a',
        'service-b': 'service-b',
      });
      getCountsByServiceStub.resolves({
        'service-a': { queued: 100 },
        'service-b': { queued: 200 },
      });

      await getDashboard(req, res, next);

      const { totals } = res.json.firstCall.args[0];
      expect(totals.queued).to.equal(300);
    });

    it('sums recent stats across all services into totals.recent', async () => {
      imageMapStub.returns({
        'image-a': 'service-a',
        'image-b': 'service-b',
      });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) => {
        if (minutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'image-a', status: 'successful', count: 10 },
            { service_id: 'image-b', status: 'successful', count: 20 },
            { service_id: 'image-b', status: 'failed', count: 5 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(minutes));
      });

      await getDashboard(req, res, next);

      const { totals } = res.json.firstCall.args[0];
      expect(totals.recent.last5Minutes.successful).to.equal(30);
      expect(totals.recent.last5Minutes.failed).to.equal(5);
    });

    it('totals.queued is zero when no services have queued items', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const { totals } = res.json.firstCall.args[0];
      expect(totals.queued).to.equal(0);
    });
  });

  // ---------------------------------------------------------------------------
  // System queue metrics
  // ---------------------------------------------------------------------------

  describe('system queue metrics', () => {
    it('includes the correct queue counts in the response', async () => {
      getCountsByServiceStub.resolves({});
      await getDashboard(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.queues.workItemScheduler).to.equal(10);
      expect(result.queues.smallWorkItemUpdates).to.equal(20);
    });
  });

  // ---------------------------------------------------------------------------
  // HTML response
  // ---------------------------------------------------------------------------

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
      expect(services[0].name).to.equal('service-b');
      expect(services[1].name).to.equal('service-c');
      expect(services[2].name).to.equal('service-a');
    });

    it('passes timeRanges to the rendered template', async () => {
      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      expect(data.timeRanges).to.exist;
      expect(data.timeRanges.last5Minutes).to.include.keys('start', 'end');
      expect(data.timeRanges.last60Minutes).to.include.keys('start', 'end');
    });

    it('includes a summary object aggregating totals for the template', async () => {
      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      expect(data.summary).to.exist;
      expect(data.summary).to.include.keys('queued', 'last5', 'last60', 'rate5', 'rate60');
    });

    it('includes formatted last5 and last60 counts on the summary', async () => {
      await getDashboard(req, res, next);

      const { summary } = res.render.firstCall.args[1];
      expect(summary.last5).to.include.keys('successful', 'failed', 'canceled', 'warning');
      expect(summary.last60).to.include.keys('successful', 'failed', 'canceled', 'warning');
    });

    it('attaches CSS class strings for counts and rates to each service row', async () => {
      imageMapStub.returns({ 'service-a': 'service-a' });
      getCountsByServiceStub.resolves({ 'service-a': { queued: 1 } });

      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      const service = data.services.find((s: any) => s.name === 'service-a');
      expect(service.last5.successfulClass).to.be.a('string');
      expect(service.last5.failedClass).to.be.a('string');
      expect(service.last60.successfulClass).to.be.a('string');
      expect(service.rate5Class).to.be.a('string');
      expect(service.rate60Class).to.be.a('string');
    });

    it('sets trendIsDown when 5-minute success rate is more than 2pp below the 60-minute rate', async () => {
      imageMapStub.returns({ 'some-image': 'some-service' });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) => {
        if (minutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'some-image', status: 'successful', count: 80 },
            { service_id: 'some-image', status: 'failed', count: 20 }, // 80% success
          ]));
        }
        // 60-min: 98% success
        return Promise.resolve(makeStatsSummaryWithRows(60, [
          { service_id: 'some-image', status: 'successful', count: 980 },
          { service_id: 'some-image', status: 'failed', count: 20 },
        ]));
      });

      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      const service = data.services.find((s: any) => s.name === 'some-service');
      expect(service.trendIsDown).to.be.true;
      expect(service.trendIsUp).to.be.false;
    });

    it('sets trendIsUp when 5-minute success rate is more than 2pp above the 60-minute rate', async () => {
      imageMapStub.returns({ 'some-image': 'some-service' });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, minutes: number) => {
        if (minutes === 5) {
          // 5-min: 99% success
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'some-image', status: 'successful', count: 99 },
            { service_id: 'some-image', status: 'failed', count: 1 },
          ]));
        }
        // 60-min: 90% success
        return Promise.resolve(makeStatsSummaryWithRows(60, [
          { service_id: 'some-image', status: 'successful', count: 900 },
          { service_id: 'some-image', status: 'failed', count: 100 },
        ]));
      });

      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      const service = data.services.find((s: any) => s.name === 'some-service');
      expect(service.trendIsUp).to.be.true;
      expect(service.trendIsDown).to.be.false;
    });

    it('marks a service as idle when it has no queued items and no recent activity', async () => {
      imageMapStub.returns({ 'idle-image': 'idle-service' });
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      const service = data.services.find((s: any) => s.name === 'idle-service');
      expect(service.isIdle).to.be.true;
    });

    it('does not mark a service as idle when it has queued items', async () => {
      imageMapStub.returns({ 'busy-image': 'busy-service' });
      getCountsByServiceStub.resolves({ 'busy-image': { queued: 1 } });

      await getDashboard(req, res, next);

      const data = res.render.firstCall.args[1];
      const service = data.services.find((s: any) => s.name === 'busy-service');
      expect(service.isIdle).to.be.false;
    });
  });
});
