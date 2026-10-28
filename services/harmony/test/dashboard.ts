/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import sinon from 'sinon';

import { getDashboard, THIRTY_YEARS_IN_MINUTES } from '../app/frontends/dashboard';
import * as userWork from '../app/models/user-work';
import * as workItemsStats from '../app/models/work-items-stats';
import { RequestValidationError } from '../app/util/errors';
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
    getWorkItemsStatsSummaryStub.callsFake((_trx: any, options: { lastMinutes: number }) =>
      Promise.resolve(makeEmptyStatsSummary(options.lastMinutes)),
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
    it('succeeds when a valid version 1 is provided', async () => {
      req.query.version = '1';
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
  // Time window validation
  // ---------------------------------------------------------------------------

  describe('time window validation', () => {
    beforeEach(() => {
      getCountsByServiceStub.resolves({});
      req.query = {};
    });

    it('accepts a window specified with lastMinutes', async () => {
      req.query['window1.lastMinutes'] = '60';

      await getDashboard(req, res, next);

      expect(next.called).to.be.false;
      expect(res.json.calledOnce).to.be.true;
    });

    it('accepts a window specified with start and end', async () => {
      req.query['window1.start'] = '2026-07-13T00:00:00Z';
      req.query['window1.end'] = '2026-07-14T00:00:00Z';

      getWorkItemsStatsSummaryStub.resolves({
        rows: [],
        start: new Date('2026-07-13T00:00:00Z'),
        end: new Date('2026-07-14T00:00:00Z'),
      });

      await getDashboard(req, res, next);

      expect(next.called).to.be.false;
      expect(res.json.calledOnce).to.be.true;
    });

    it('rejects an invalid start timestamp', async () => {
      req.query['window1.start'] = 'not-a-date';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1.start must be a valid ISO-8601 timestamp.');
    });

    it('rejects an invalid end timestamp', async () => {
      req.query['window1.start'] = '2026-07-13T00:00:00Z';
      req.query['window1.end'] = 'not-a-date';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1.end must be a valid ISO-8601 timestamp.');
    });

    it('rejects a non-numeric lastMinutes value', async () => {
      req.query['window1.lastMinutes'] = 'abc';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1.lastMinutes must be a positive integer.');
    });

    it('rejects a zero lastMinutes value', async () => {
      req.query['window1.lastMinutes'] = '0';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1.lastMinutes must be greater than zero.');
    });

    it('rejects a lastMinutes value that is too large', async () => {
      req.query['window1.lastMinutes'] = '15768001'; // 30 years + 1 minute

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1.lastMinutes must be less than or equal to 15768000.');
    });

    it('rejects start together with lastMinutes', async () => {
      req.query['window1.start'] = '2026-07-13T00:00:00Z';
      req.query['window1.lastMinutes'] = '60';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1: start and lastMinutes are mutually exclusive.');
    });

    it('rejects a window with neither start nor lastMinutes', async () => {
      req.query['window1.label'] = 'A Window';
      req.query['window1.end'] = '2026-07-14T00:00:00Z';
      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1: either start or lastMinutes must be provided.');
    });

    it('rejects start that is after end', async () => {
      req.query['window1.start'] = '2026-07-14T00:00:00Z';
      req.query['window1.end'] = '2026-07-13T00:00:00Z';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1: start must be earlier than end.');
    });

    it('rejects an empty label', async () => {
      req.query['window1.label'] = '   ';
      req.query['window1.lastMinutes'] = '60';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window1: label may not be empty.');
    });

    it('validates the second window independently', async () => {
      req.query['window1.lastMinutes'] = '60';
      req.query['window2.start'] = 'not-a-date';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message)
        .to.equal('window2.start must be a valid ISO-8601 timestamp.');
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

      expect(result.version).to.equal('1');
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
      expect(services['some-old-image'].windows).to.exist;
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
        expect(service.windows).to.exist;
        expect(service.windows.last5Minutes).to.include.keys('successful', 'failed', 'canceled', 'warning');
        expect(service.windows.last60Minutes).to.include.keys('successful', 'failed', 'canceled', 'warning');
      }
    });

    it('defaults all recent counts to zero when stats summary returns no rows', async () => {
      getCountsByServiceStub.resolves({});

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      const service = services['query-cmr'];
      expect(service.windows.last5Minutes).to.deep.equal({ successful: 0, failed: 0, canceled: 0, warning: 0 });
      expect(service.windows.last60Minutes).to.deep.equal({ successful: 0, failed: 0, canceled: 0, warning: 0 });
    });

    it('populates last5Minutes counts from the stats summary for the correct service', async () => {
      imageMapStub.returns({ 'podaac/l2ss-py': 'podaac-l2-subsetter' });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, options: { lastMinutes: number }) => {
        if (options.lastMinutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'podaac/l2ss-py', status: 'successful', count: 42 },
            { service_id: 'podaac/l2ss-py', status: 'failed', count: 3 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(options.lastMinutes));
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['podaac-l2-subsetter'].windows.last5Minutes.successful).to.equal(42);
      expect(services['podaac-l2-subsetter'].windows.last5Minutes.failed).to.equal(3);
      expect(services['podaac-l2-subsetter'].windows.last5Minutes.canceled).to.equal(0);
      expect(services['podaac-l2-subsetter'].windows.last5Minutes.warning).to.equal(0);
    });

    it('populates last60Minutes counts independently from the 5-minute window', async () => {
      imageMapStub.returns({ 'podaac/l2ss-py': 'podaac-l2-subsetter' });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, options: { lastMinutes: number }) => {
        if (options.lastMinutes === 60) {
          return Promise.resolve(makeStatsSummaryWithRows(60, [
            { service_id: 'podaac/l2ss-py', status: 'successful', count: 500 },
            { service_id: 'podaac/l2ss-py', status: 'warning', count: 10 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(options.lastMinutes));
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['podaac-l2-subsetter'].windows.last60Minutes.successful).to.equal(500);
      expect(services['podaac-l2-subsetter'].windows.last60Minutes.warning).to.equal(10);
      expect(services['podaac-l2-subsetter'].windows.last60Minutes.failed).to.equal(0);
    });

    it('aggregates recent counts when multiple rows share the same service and status', async () => {
      imageMapStub.returns({
        'image-a': 'shared-service',
        'image-b': 'shared-service',
      });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, options: { lastMinutes: number }) => {
        if (options.lastMinutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'image-a', status: 'successful', count: 10 },
            { service_id: 'image-b', status: 'successful', count: 20 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(options.lastMinutes));
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      expect(services['shared-service'].windows.last5Minutes.successful).to.equal(30);
    });

    it('ignores rows with untracked statuses in the stats summary', async () => {
      imageMapStub.returns({ 'some-image': 'some-service' });
      getCountsByServiceStub.resolves({});

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, options: { lastMinutes: number }) => {
        if (options.lastMinutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'some-image', status: 'running', count: 99 },
            { service_id: 'some-image', status: 'successful', count: 5 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(options.lastMinutes));
      });

      await getDashboard(req, res, next);

      const { services } = res.json.firstCall.args[0];
      // 'running' is not a tracked status — only 'successful' should appear
      expect(services['some-service'].windows.last5Minutes.successful).to.equal(5);
      expect((services['some-service'].windows.last5Minutes as any).running).to.be.undefined;
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

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, options: { lastMinutes: number }) => {
        if (options.lastMinutes === 5) return Promise.resolve({ rows: [], start: fixedStart5, end: fixedEnd });
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

      getWorkItemsStatsSummaryStub.callsFake((_trx: any, options: { lastMinutes: number }) => {
        if (options.lastMinutes === 5) {
          return Promise.resolve(makeStatsSummaryWithRows(5, [
            { service_id: 'image-a', status: 'successful', count: 10 },
            { service_id: 'image-b', status: 'successful', count: 20 },
            { service_id: 'image-b', status: 'failed', count: 5 },
          ]));
        }
        return Promise.resolve(makeEmptyStatsSummary(options.lastMinutes));
      });

      await getDashboard(req, res, next);

      const { totals } = res.json.firstCall.args[0];
      expect(totals.windows.last5Minutes.successful).to.equal(30);
      expect(totals.windows.last5Minutes.failed).to.equal(5);
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
  // Time window query validation
  // ---------------------------------------------------------------------------

  describe('time window query validation', () => {
    beforeEach(() => {
      getCountsByServiceStub.resolves({});
    });

    it('rejects a whitespace-only label with a RequestValidationError', async () => {
      req.query = { 'window1.label': '   ', 'window1.lastminutes': '5' };
      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.be.instanceOf(RequestValidationError);
    });
    it('rejects a non-positive lastMinutes value', async () => {
      req.query = { 'window1.lastminutes': '0' };
      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.be.instanceOf(RequestValidationError);
    });
    it('rejects a lastMinutes value above the allowed maximum', async () => {
      req.query = { 'window1.lastminutes': String(THIRTY_YEARS_IN_MINUTES + 1) };
      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.be.instanceOf(RequestValidationError);
    });
    it('rejects an unparseable ISO start date', async () => {
      req.query = { 'window1.start': 'not-a-date' };
      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.be.instanceOf(RequestValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // HTML response - only a shell, which loads its data from the dashboard API
  // ---------------------------------------------------------------------------

  describe('HTML response', () => {
    beforeEach(() => {
      req.accepts.returns('html');
    });

    it('renders the dashboard page with the harmony version', async () => {
      await getDashboard(req, res, next);

      expect(next.called).to.be.false;
      expect(res.render.calledOnce).to.be.true;
      expect(res.render.firstCall.args[0]).to.equal('dashboard');
      expect(res.render.firstCall.args[1]).to.have.keys('version');
      expect(res.json.called).to.be.false;
    });

    it('does not query any stats, since the page loads them from the dashboard API', async () => {
      await getDashboard(req, res, next);

      expect(getCountsByServiceStub.called).to.be.false;
      expect(getWorkItemsStatsSummaryStub.called).to.be.false;
    });

    it('logs the requesting user', async () => {
      await getDashboard(req, res, next);

      expect(req.context.logger.info.calledOnce).to.be.true;
      expect(req.context.logger.info.firstCall.args[0]).to.include('test-user');
    });

    it('still rejects an unsupported version', async () => {
      req.query.version = '2.0-beta';

      await getDashboard(req, res, next);

      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0].message).to.include('Invalid API version');
      expect(res.render.called).to.be.false;
    });
  });
});
