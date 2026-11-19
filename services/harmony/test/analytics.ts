import http from 'http';
import { AddressInfo } from 'net';

import { expect } from 'chai';
import express from 'express';
import { after, before, describe, it } from 'mocha';
import sinon from 'sinon';
import request from 'supertest';

import { auth } from './helpers/auth';
import hookServersStartStop from './helpers/servers';
import { truncateAll } from '../../../packages/util/test/helpers/db';
import AnalyticsQuery from '../app/models/analytics-query';
import db from '../app/util/db';
import env from '../app/util/env';

const ADMIN = 'adam';
const LOG_VIEWER = 'log-viewer-not-bo';
// In no groups (fixtures/uat.urs.earthdata.nasa.gov-443/no-groups-bo). Note woody, the usual
// non-admin test user, is a log viewer. Neither can use the analytics UI, which is admin-only.
const OTHER_USER = 'bo';

interface StubCall {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

/**
 * Starts a stand-in for the analytics query service that records each request and answers with
 * the given status and body
 *
 * @returns the server, the calls it received, and a way to set its next response
 */
async function startStubService(): Promise<{
  server: http.Server, url: string, calls: StubCall[], respond: (status: number, body: object) => void,
}> {
  const calls: StubCall[] = [];
  let response = { status: 200, body: {} };
  const app = express();
  app.use(express.json());
  app.all('/api/:endpoint', (req, res) => {
    calls.push({ method: req.method, path: req.path, headers: req.headers, body: req.body });
    res.status(response.status).json(response.body);
  });
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    server, url: `http://127.0.0.1:${port}`, calls, respond: (status, body): void => { response = { status, body }; },
  };
}

describe('/admin/analytics', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  let stub: Awaited<ReturnType<typeof startStubService>>;
  const sandbox = sinon.createSandbox();

  before(async function () {
    stub = await startStubService();
    sandbox.stub(env, 'analyticsQueryUrl').value(stub.url);
    sandbox.stub(env, 'analyticsQuerySharedSecret').value('test-secret');
  });

  after(function () {
    sandbox.restore();
    stub.server.close();
  });

  const page = (app, username: string): request.Test =>
    request(app).get('/admin/analytics').set('Accept', 'text/html').use(auth({ username }));
  const getApi = (app, endpoint: string, username = ADMIN): request.Test =>
    request(app).get(`/admin/analytics/api/${endpoint}`).use(auth({ username }));
  const postApi = (app, endpoint: string, body: object, username = ADMIN): request.Test =>
    request(app).post(`/admin/analytics/api/${endpoint}`).send(body).use(auth({ username }));

  describe('access', function () {
    it('shows the page to an admin', async function () {
      const res = await page(this.frontend, ADMIN);
      expect(res.status).to.equal(200);
      expect(res.text).to.include('/js/analytics/index.js');
    });

    const itForbids = (who: string, username: string): void => {
      it(`forbids the page to ${who}`, async function () {
        const res = await page(this.frontend, username);
        expect(res.status).to.equal(403);
      });

      it(`forbids every API endpoint to ${who}, without calling the service`, async function () {
        const callsBefore = stub.calls.length;
        const responses = await Promise.all([
          getApi(this.frontend, 'schema', username),
          postApi(this.frontend, 'validate', { sql: 'SELECT 1' }, username),
          postApi(this.frontend, 'query', { sql: 'SELECT 1' }, username),
          request(this.frontend).get('/admin/analytics/api/queries').use(auth({ username })),
          request(this.frontend).post('/admin/analytics/api/queries').send({ name: 'x', sql: 'SELECT 1' }).use(auth({ username })),
        ]);
        expect(responses.map((r) => r.status)).to.eql([403, 403, 403, 403, 403]);
        expect(stub.calls.length).to.equal(callsBefore);
      });
    };
    itForbids('a log viewer', LOG_VIEWER);
    itForbids('a user in no groups', OTHER_USER);
  });

  describe('the API proxy', function () {
    it('sends the shared secret and the user to the service', async function () {
      stub.respond(200, { tables: [], warnings: [], loadedAt: 'now' });
      await getApi(this.frontend, 'schema');
      const call = stub.calls[stub.calls.length - 1];
      expect(call.method).to.equal('GET');
      expect(call.path).to.equal('/api/schema');
      expect(call.headers.authorization).to.equal('Bearer test-secret');
      expect(call.headers['x-harmony-user']).to.equal(ADMIN);
    });

    it('passes the query on and the service response back as-is', async function () {
      const result = { columns: [{ name: 'n', type: 'BIGINT' }], rows: [[1]], rowCount: 1, truncated: false, durationMs: 3 };
      stub.respond(200, result);
      const body = { sql: 'SELECT count(*) AS n FROM jobs WHERE status = $status', params: { status: 'failed' } };
      const res = await postApi(this.frontend, 'query', body);
      expect(res.status).to.equal(200);
      expect(res.body).to.eql(result);
      expect(stub.calls[stub.calls.length - 1].body).to.eql(body);
    });

    it('passes the service errors back with their status', async function () {
      const error = { code: 400, message: 'The query is not valid', errors: [{ message: 'Only SELECT queries are allowed', position: null }] };
      stub.respond(400, error);
      const res = await postApi(this.frontend, 'query', { sql: 'DELETE FROM jobs' });
      expect(res.status).to.equal(400);
      expect(res.body).to.eql(error);
    });

    it('rejects an endpoint the service does not have', async function () {
      const callsBefore = stub.calls.length;
      const res = await getApi(this.frontend, 'liveness');
      expect(res.status).to.equal(404);
      expect(stub.calls.length).to.equal(callsBefore);
    });

    it('rejects GET for an endpoint that needs POST', async function () {
      const res = await getApi(this.frontend, 'query');
      expect(res.status).to.equal(404);
    });

    it('rejects a POST that is not JSON, so a cross-site form cannot run a query', async function () {
      const callsBefore = stub.calls.length;
      const res = await request(this.frontend).post('/admin/analytics/api/query')
        .type('form').send('sql=SELECT 1').use(auth({ username: ADMIN }));
      expect(res.status).to.equal(415);
      expect(stub.calls.length).to.equal(callsBefore);
    });

    describe('when the service is not running', function () {
      before(function () {
        // A port nothing is listening on
        sandbox.stub(env, 'analyticsQueryUrl').value('http://127.0.0.1:9');
      });
      after(function () {
        sandbox.stub(env, 'analyticsQueryUrl').value(stub.url);
      });

      it('says the service is not available', async function () {
        const res = await getApi(this.frontend, 'schema');
        expect(res.status).to.equal(503);
        expect(res.body.message).to.equal('The analytics query service is not available');
      });
    });
  });
});

describe('/admin/analytics/api/queries (saved queries)', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  before(async function () {
    await truncateAll();
  });
  after(async function () {
    await truncateAll();
  });

  interface QueriesApi {
    list: (app) => request.Test;
    get: (app, id: number | string) => request.Test;
    create: (app, body: object) => request.Test;
    update: (app, id: number, body: object) => request.Test;
    delete: (app, id: number) => request.Test;
  }
  const as = (username: string): QueriesApi => ({
    list: (app): request.Test => request(app).get('/admin/analytics/api/queries').use(auth({ username })),
    get: (app, id: number | string): request.Test => request(app).get(`/admin/analytics/api/queries/${id}`).use(auth({ username })),
    create: (app, body: object): request.Test => request(app).post('/admin/analytics/api/queries').send(body).use(auth({ username })),
    update: (app, id: number, body: object): request.Test => request(app).put(`/admin/analytics/api/queries/${id}`).send(body).use(auth({ username })),
    delete: (app, id: number): request.Test => request(app).delete(`/admin/analytics/api/queries/${id}`).use(auth({ username })),
  });
  const admin = as(ADMIN);
  const logViewer = as(LOG_VIEWER);
  const other = as(OTHER_USER);

  const failedByStatus = {
    name: 'Failed jobs by service',
    description: 'Since a date',
    sql: 'SELECT service_name, count(*) FROM jobs WHERE status = $status AND created_at >= $start GROUP BY 1',
    parameters: { status: 'failed', start: '2026-11-01T00:00:00Z' },
  };
  let adminQueryId: number;
  // Queries saved by another admin. The EDL fixtures have only one admin (adam), so these are
  // created directly in the database.
  const ANOTHER_ADMIN = 'another-admin';
  let anotherQueryId: number;

  before(async function () {
    const mine = new AnalyticsQuery({ username: ANOTHER_ADMIN, name: 'My query', sql: 'SELECT 1' });
    await mine.save(db);
    anotherQueryId = mine.id;
    await new AnalyticsQuery({ username: ANOTHER_ADMIN, name: failedByStatus.name, sql: 'SELECT 1' }).save(db);
  });

  describe('saving a query', function () {
    it('saves it, owned by the user, and returns it', async function () {
      const res = await admin.create(this.frontend, failedByStatus);
      expect(res.status).to.equal(201);
      const { parameters, ...fields } = failedByStatus;
      expect(res.body).to.include({ ...fields, owner: ADMIN, chart: null });
      expect(res.body.parameters).to.eql(parameters);
      expect(res.body.id).to.be.a('number');
      adminQueryId = res.body.id;
    });

    it('saves list parameter defaults', async function () {
      const res = await admin.create(this.frontend, { name: 'With a list', sql: 'SELECT 1', parameters: { ids: [1, 2] } });
      expect(res.status).to.equal(201);
      expect(res.body.parameters).to.eql({ ids: [1, 2] });
    });

    it('rejects a second query with the same name from the same user', async function () {
      const res = await admin.create(this.frontend, { ...failedByStatus, sql: 'SELECT 2' });
      expect(res.status).to.equal(409);
    });

    it('allows a name another user already has', async function () {
      const res = await admin.create(this.frontend, { name: 'My query', sql: 'SELECT 1' });
      expect(res.status).to.equal(201);
    });

    for (const [problem, body] of [
      ['no name', { sql: 'SELECT 1' }],
      ['a blank name', { name: '  ', sql: 'SELECT 1' }],
      ['no sql', { name: 'x' }],
      ['a name that is too long', { name: 'x'.repeat(256), sql: 'SELECT 1' }],
      ['parameters that are not an object', { name: 'x', sql: 'SELECT 1', parameters: [1] }],
      ['a parameter value that is an object', { name: 'x', sql: 'SELECT 1', parameters: { a: { b: 1 } } }],
      ['a name that is not a string', { name: 5, sql: 'SELECT 1' }],
    ]) {
      it(`rejects a query with ${problem}`, async function () {
        const res = await admin.create(this.frontend, body as object);
        expect(res.status).to.equal(400);
        expect(res.body.errors.length).to.be.greaterThan(0);
      });
    }

    it('saves a row limit with the query', async function () {
      const res = await admin.create(this.frontend, { name: 'Two rows', sql: 'SELECT 1', rowLimit: 2 });
      expect(res.status).to.equal(201);
      expect(res.body.rowLimit).to.equal(2);
      const changed = await admin.update(this.frontend, res.body.id, { rowLimit: 25 });
      expect(changed.body.rowLimit).to.equal(25);
      expect((await admin.get(this.frontend, res.body.id)).body.rowLimit).to.equal(25);
      const cleared = await admin.update(this.frontend, res.body.id, { rowLimit: null });
      expect(cleared.body.rowLimit).to.be.null;
      expect((await admin.delete(this.frontend, res.body.id)).status).to.equal(204);
    });

    it('has no row limit unless one is saved', async function () {
      const res = await admin.create(this.frontend, { name: 'No limit', sql: 'SELECT 1' });
      expect(res.body.rowLimit).to.be.null;
      expect((await admin.delete(this.frontend, res.body.id)).status).to.equal(204);
    });

    it('rejects a row limit that is not a whole number from 1 to the maximum', async function () {
      for (const rowLimit of [0, -1, 2.5, '10', 100_001]) {
        const res = await admin.create(this.frontend, { name: `bad limit ${rowLimit}`, sql: 'SELECT 1', rowLimit });
        expect(res.status, JSON.stringify(rowLimit)).to.equal(400);
        expect(res.body.errors[0].message).to.include('rowLimit must be');
      }
    });

    it('saves a chart with the query', async function () {
      const chart = { type: 'line', x: 'day', y: ['jobs'], series: 'service_name' };
      const res = await admin.create(this.frontend, { name: 'Jobs per day', sql: 'SELECT 1', chart });
      expect(res.status).to.equal(201);
      expect(res.body.chart).to.eql(chart);

      const changed = await admin.update(this.frontend, res.body.id, { chart: { type: 'column', x: 'day', y: ['jobs', 'failed'] } });
      expect(changed.body.chart).to.eql({ type: 'column', x: 'day', y: ['jobs', 'failed'], series: null });
      const removed = await admin.update(this.frontend, res.body.id, { chart: null });
      expect(removed.body.chart).to.be.null;
      expect((await admin.delete(this.frontend, res.body.id)).status).to.equal(204);
    });

    it('saves single number and donut charts', async function () {
      const stat = await admin.create(this.frontend, { name: 'Failed today', sql: 'SELECT 1', chart: { type: 'stat', y: ['n'] } });
      expect(stat.status).to.equal(201);
      expect(stat.body.chart).to.eql({ type: 'stat', x: null, y: ['n'], series: null });
      const donut = await admin.create(this.frontend, { name: 'Share by status', sql: 'SELECT 1', chart: { type: 'donut', x: 'status', y: ['n'] } });
      expect(donut.status).to.equal(201);
      expect(donut.body.chart).to.eql({ type: 'donut', x: 'status', y: ['n'], series: null });
      for (const id of [stat.body.id, donut.body.id]) expect((await admin.delete(this.frontend, id)).status).to.equal(204);
    });

    for (const [problem, chart] of [
      ['a single number of two columns', { type: 'stat', y: ['a', 'b'] }],
      ['a donut without a category column', { type: 'donut', y: ['n'] }],
      ['a donut split into series', { type: 'donut', x: 'a', y: ['n'], series: 's' }],
      ['an unknown chart type', { type: 'pie', x: 'a', y: ['b'] }],
      ['no values to chart', { type: 'line', x: 'a', y: [] }],
      ['more than eight values', { type: 'line', x: 'a', y: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }],
      ['an x axis that is not a column name', { type: 'line', x: 5, y: ['b'] }],
      ['a chart that is not an object', 'line'],
    ]) {
      it(`rejects a chart with ${problem}`, async function () {
        const res = await admin.create(this.frontend, { name: `bad chart: ${problem}`, sql: 'SELECT 1', chart });
        expect(res.status).to.equal(400);
        expect(res.body.errors[0].message).to.include('chart must be');
      });
    }

    it('rejects a body that is not JSON', async function () {
      const res = await request(this.frontend).post('/admin/analytics/api/queries')
        .type('form').send('name=x&sql=SELECT+1').use(auth({ username: ADMIN }));
      expect(res.status).to.equal(415);
    });

    it('forbids users who are not admins, including log viewers', async function () {
      expect((await other.create(this.frontend, { name: 'x', sql: 'SELECT 1' })).status).to.equal(403);
      expect((await logViewer.create(this.frontend, { name: 'x', sql: 'SELECT 1' })).status).to.equal(403);
    });
  });

  describe('reading saved queries', function () {
    it('lists everyone\'s queries, most recently changed first', async function () {
      const res = await admin.list(this.frontend);
      expect(res.status).to.equal(200);
      expect(res.body.queries.map((q) => q.owner)).to.include.members([ADMIN, ANOTHER_ADMIN]);
      const times = res.body.queries.map((q) => new Date(q.updatedAt).getTime());
      expect(times).to.eql([...times].sort((a, b) => b - a));
    });

    it('gets one query', async function () {
      const res = await admin.get(this.frontend, anotherQueryId);
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ name: 'My query', owner: ANOTHER_ADMIN });
    });

    it('says when there is no such query', async function () {
      expect((await admin.get(this.frontend, 999999)).status).to.equal(404);
      expect((await admin.get(this.frontend, 'nope')).status).to.equal(404);
    });

    it('forbids users who are not admins, including log viewers', async function () {
      for (const user of [other, logViewer]) {
        expect((await user.list(this.frontend)).status).to.equal(403);
        expect((await user.get(this.frontend, adminQueryId)).status).to.equal(403);
      }
    });
  });

  describe('changing a saved query', function () {
    it('lets the owner change it, keeping fields left out of the request', async function () {
      const res = await admin.update(this.frontend, adminQueryId, { sql: 'SELECT 3', parameters: {} });
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ name: failedByStatus.name, description: failedByStatus.description, sql: 'SELECT 3' });
      expect(res.body.parameters).to.eql({});
      expect((await admin.get(this.frontend, adminQueryId)).body.sql).to.equal('SELECT 3');
    });

    it('does not let a user who is not an admin change it', async function () {
      const res = await logViewer.update(this.frontend, adminQueryId, { sql: 'SELECT 4' });
      expect(res.status).to.equal(403);
      expect((await admin.get(this.frontend, adminQueryId)).body.sql).to.equal('SELECT 3');
    });

    it('lets an admin change another admin\'s, keeping its owner', async function () {
      const res = await admin.update(this.frontend, anotherQueryId, { description: 'tidied up' });
      expect(res.status).to.equal(200);
      expect(res.body.owner).to.equal(ANOTHER_ADMIN);
    });

    it('rejects renaming it to the name of another of the owner\'s queries', async function () {
      const res = await admin.update(this.frontend, anotherQueryId, { name: failedByStatus.name });
      expect(res.status).to.equal(409);
    });

    it('rejects invalid changes', async function () {
      const res = await admin.update(this.frontend, adminQueryId, { sql: '' });
      expect(res.status).to.equal(400);
    });
  });

  describe('deleting a saved query', function () {
    it('does not let a user who is not an admin delete it', async function () {
      expect((await logViewer.delete(this.frontend, adminQueryId)).status).to.equal(403);
      expect((await admin.get(this.frontend, adminQueryId)).status).to.equal(200);
    });

    it('lets the owner delete it', async function () {
      expect((await admin.delete(this.frontend, adminQueryId)).status).to.equal(204);
      expect((await admin.get(this.frontend, adminQueryId)).status).to.equal(404);
    });

    it('lets an admin delete another admin\'s', async function () {
      expect((await admin.delete(this.frontend, anotherQueryId)).status).to.equal(204);
      expect((await admin.get(this.frontend, anotherQueryId)).status).to.equal(404);
    });
  });
});
