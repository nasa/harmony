import http from 'http';
import { AddressInfo } from 'net';

import { expect } from 'chai';
import express from 'express';
import { after, before, describe, it } from 'mocha';
import sinon from 'sinon';
import request from 'supertest';

import { auth } from './helpers/auth';
import hookServersStartStop from './helpers/servers';
import env from '../app/util/env';

const ADMIN = 'adam';
const LOG_VIEWER = 'log-viewer-not-bo';
// In no groups (fixtures/uat.urs.earthdata.nasa.gov-443/no-groups-bo). Note woody, the usual
// non-admin test user, is a log viewer.
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

    it('shows the page to a log viewer', async function () {
      const res = await page(this.frontend, LOG_VIEWER);
      expect(res.status).to.equal(200);
    });

    it('forbids the page to a user who is neither', async function () {
      const res = await page(this.frontend, OTHER_USER);
      expect(res.status).to.equal(403);
    });

    it('lets a log viewer use the API', async function () {
      stub.respond(200, { tables: [], warnings: [], loadedAt: 'now' });
      const res = await getApi(this.frontend, 'schema', LOG_VIEWER);
      expect(res.status).to.equal(200);
    });

    it('forbids the API to a user who is neither', async function () {
      const callsBefore = stub.calls.length;
      const res = await postApi(this.frontend, 'query', { sql: 'SELECT 1' }, OTHER_USER);
      expect(res.status).to.equal(403);
      expect(stub.calls.length).to.equal(callsBefore);
    });

    it('still forbids other admin pages to a log viewer', async function () {
      for (const path of ['/admin/dashboard', '/admin/jobs', '/admin/analytics-other', '/admin/retry-stats']) {
        const res = await request(this.frontend).get(path).use(auth({ username: LOG_VIEWER }));
        expect(res.status, path).to.equal(403);
      }
    });
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
