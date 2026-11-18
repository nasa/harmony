import { expect } from 'chai';
import { Express } from 'express';
import { after, before, describe, it } from 'mocha';
import request, { Test } from 'supertest';

import { AnalyticsDb } from '../app/query/analytics-db';
import { USER_HEADER } from '../app/routers/router';
import { createApp } from '../app/server';
import { fixtureDb } from './helpers/db';
import { JOB_COUNT } from './helpers/fixture';
import env from '../app/util/env';

describe('analytics query API', () => {
  let db: AnalyticsDb;
  let app: Express;

  before(async () => {
    db = fixtureDb();
    app = createApp(db);
    await db.init();
  });
  after(() => db.close());

  const authorized = (test: Test): Test => test
    .set('Authorization', `Bearer ${env.analyticsQuerySharedSecret}`)
    .set(USER_HEADER, 'test-user');

  describe('health checks', () => {
    it('is live', async () => {
      await request(app).get('/liveness').expect(200, 'OK');
    });

    it('is ready once the catalog is attached', async () => {
      await request(app).get('/readiness').expect(200, 'OK');
    });

    it('is not ready before the catalog is attached', async () => {
      const notYet = createApp(fixtureDb());
      await request(notYet).get('/readiness').expect(503);
    });
  });

  describe('authorization', () => {
    it('rejects a request without credentials', async () => {
      await request(app).get('/api/schema').expect(401);
    });

    it('rejects the wrong shared secret', async () => {
      await request(app).get('/api/schema').set('Authorization', 'Bearer wrong').set(USER_HEADER, 'u').expect(401);
    });

    it('rejects a request that does not say which user it is for', async () => {
      await request(app).get('/api/schema').set('Authorization', `Bearer ${env.analyticsQuerySharedSecret}`).expect(400);
    });
  });

  describe('GET /api/schema', () => {
    it('lists the tables and their columns', async () => {
      const { body } = await authorized(request(app).get('/api/schema')).expect(200);
      expect(body.tables.map((t) => t.name)).to.eql(['job_links', 'jobs', 'work_items']);
      expect(body.tables[1].columns[0]).to.eql({ name: 'id', type: 'BIGINT' });
    });

    it('warns about timestamp columns that are not TIMESTAMPTZ', async () => {
      const { body } = await authorized(request(app).get('/api/schema')).expect(200);
      expect(body.warnings).to.have.length(1);
      expect(body.warnings[0]).to.include('job_links.updated_at is VARCHAR');
    });
  });

  describe('POST /api/validate', () => {
    it('describes a valid query', async () => {
      const { body } = await authorized(request(app).post('/api/validate'))
        .send({ sql: 'SELECT id FROM jobs WHERE status = $status' }).expect(200);
      expect(body).to.eql({
        valid: true, errors: [], columns: [{ name: 'id', type: 'BIGINT' }], parameters: [{ name: 'status', type: 'VARCHAR' }],
      });
    });

    it('reports what is wrong with an invalid query, with a 200', async () => {
      const { body } = await authorized(request(app).post('/api/validate')).send({ sql: 'DELETE FROM jobs' }).expect(200);
      expect(body.valid).to.be.false;
      expect(body.errors[0].message).to.equal('Only SELECT queries are allowed');
    });

    it('requires a sql string', async () => {
      await authorized(request(app).post('/api/validate')).send({ query: 'SELECT 1' }).expect(400);
    });
  });

  describe('POST /api/query', () => {
    it('runs a query with parameters', async () => {
      const { body } = await authorized(request(app).post('/api/query'))
        .send({ sql: 'SELECT count(*) AS n FROM jobs WHERE id < $max', params: { max: 10 } }).expect(200);
      expect(body.columns).to.eql([{ name: 'n', type: 'BIGINT' }]);
      expect(body.rows).to.eql([[10]]);
      expect(body.truncated).to.be.false;
      expect(body.durationMs).to.be.a('number');
    });

    it('caps the rows', async () => {
      const { body } = await authorized(request(app).post('/api/query')).send({ sql: 'SELECT id FROM jobs' }).expect(200);
      expect(body.rowCount).to.equal(Math.min(JOB_COUNT, env.analyticsQueryMaxRows));
    });

    it('rejects an invalid query with its problems', async () => {
      const { body } = await authorized(request(app).post('/api/query'))
        .send({ sql: 'SELECT * FROM read_text(\'/etc/passwd\')' }).expect(400);
      expect(body.message).to.equal('The query is not valid');
      expect(body.errors[0]).to.eql({ message: 'Table function read_text is not allowed', position: 14 });
    });

    it('rejects parameters that are not an object', async () => {
      await authorized(request(app).post('/api/query')).send({ sql: 'SELECT 1', params: [1] }).expect(400);
    });

    it('rejects a body that is not JSON', async () => {
      const { body } = await authorized(request(app).post('/api/query'))
        .set('Content-Type', 'application/json').send('{nope').expect(400);
      expect(body.message).to.equal('The request body is not valid JSON');
    });
  });
});
