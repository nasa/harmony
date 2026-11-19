import { expect } from 'chai';
import { after, before, describe, it } from 'mocha';
import request from 'supertest';

import { auth } from './helpers/auth';
import hookServersStartStop from './helpers/servers';
import { truncateAll } from '../../../packages/util/test/helpers/db';
import AnalyticsDashboard, { MAX_PANELS } from '../app/models/analytics-dashboard';
import db from '../app/util/db';

const ADMIN = 'adam';
const LOG_VIEWER = 'log-viewer-not-bo';
const OTHER_USER = 'bo';
// The EDL fixtures have only one admin, so another admin's dashboard is created in the database
const ANOTHER_ADMIN = 'another-admin';

describe('/admin/analytics/dashboards', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  before(async function () {
    await truncateAll();
  });
  after(async function () {
    await truncateAll();
  });

  interface DashboardsApi {
    list: (app) => request.Test;
    get: (app, id: number | string) => request.Test;
    create: (app, body: object) => request.Test;
    update: (app, id: number, body: object) => request.Test;
    delete: (app, id: number) => request.Test;
  }
  const api = (username: string): DashboardsApi => ({
    list: (app): request.Test => request(app).get('/admin/analytics/api/dashboards').use(auth({ username })),
    get: (app, id: number | string): request.Test => request(app).get(`/admin/analytics/api/dashboards/${id}`).use(auth({ username })),
    create: (app, body: object): request.Test => request(app).post('/admin/analytics/api/dashboards').send(body).use(auth({ username })),
    update: (app, id: number, body: object): request.Test => request(app).put(`/admin/analytics/api/dashboards/${id}`).send(body).use(auth({ username })),
    delete: (app, id: number): request.Test => request(app).delete(`/admin/analytics/api/dashboards/${id}`).use(auth({ username })),
  });
  const admin = api(ADMIN);

  const jobsDashboard = {
    name: 'Jobs',
    description: 'Jobs and work items',
    panels: [
      { queryId: 1, display: 'chart', width: 'full', limit: 5000 },
      { queryId: 2 },
    ],
    parameters: { start: '2026-11-01T00:00:00Z', statuses: ['failed', 'successful'] },
  };
  let dashboardId: number;
  let anotherId: number;

  before(async function () {
    const another = new AnalyticsDashboard({ username: ANOTHER_ADMIN, name: 'Theirs' });
    another.setPanels([{ queryId: 3 }]);
    await another.save(db);
    anotherId = another.id;
  });

  describe('the tab', function () {
    it('shows the dashboards page to an admin, with the tabs', async function () {
      const res = await request(this.frontend).get('/admin/analytics/dashboards').set('Accept', 'text/html')
        .use(auth({ username: ADMIN }));
      expect(res.status).to.equal(200);
      expect(res.text).to.include('/js/analytics/dashboards.js');
      expect(res.text).to.include('href="/admin/analytics"');
      expect(res.text).to.match(/analytics-tab is-active"[^>]*aria-current="page">\s*<i[^>]*><\/i> Dashboards/);
    });

    it('marks the Query tab as current on the query page', async function () {
      const res = await request(this.frontend).get('/admin/analytics').set('Accept', 'text/html')
        .use(auth({ username: ADMIN }));
      expect(res.text).to.match(/analytics-tab is-active"[^>]*aria-current="page">\s*<i[^>]*><\/i> Query/);
    });

    it('forbids the page and API to users who are not admins', async function () {
      for (const username of [LOG_VIEWER, OTHER_USER]) {
        const statuses = (await Promise.all([
          request(this.frontend).get('/admin/analytics/dashboards').use(auth({ username })),
          api(username).list(this.frontend),
          api(username).create(this.frontend, { name: 'x', panels: [] }),
          api(username).get(this.frontend, anotherId),
          api(username).delete(this.frontend, anotherId),
        ])).map((r) => r.status);
        expect(statuses, username).to.eql([403, 403, 403, 403, 403]);
      }
    });
  });

  describe('saving a dashboard', function () {
    it('saves it, owned by the user, with the panel defaults filled in', async function () {
      const res = await admin.create(this.frontend, jobsDashboard);
      expect(res.status).to.equal(201);
      expect(res.body).to.include({ name: 'Jobs', description: 'Jobs and work items', owner: ADMIN });
      expect(res.body.panels).to.eql([
        { queryId: 1, display: 'chart', width: 'full', limit: 5000 },
        { queryId: 2, display: 'chart', width: 'half', limit: null },
      ]);
      expect(res.body.parameters).to.eql(jobsDashboard.parameters);
      dashboardId = res.body.id;
    });

    it('keeps a panel limit of null, which means its query\'s row limit', async function () {
      const res = await admin.create(this.frontend, { name: 'Follows its queries', panels: [{ queryId: 1, limit: null }] });
      expect(res.status).to.equal(201);
      expect(res.body.panels[0].limit).to.be.null;
    });

    it('saves a dashboard with no panels yet', async function () {
      const res = await admin.create(this.frontend, { name: 'Empty', panels: [] });
      expect(res.status).to.equal(201);
      expect(res.body.panels).to.eql([]);
    });

    it('rejects a second dashboard with the same name from the same user', async function () {
      expect((await admin.create(this.frontend, jobsDashboard)).status).to.equal(409);
    });

    it('allows a name another user already has', async function () {
      expect((await admin.create(this.frontend, { name: 'Theirs', panels: [] })).status).to.equal(201);
    });

    for (const [problem, body] of [
      ['no name', { panels: [] }],
      ['panels that are not a list', { name: 'x', panels: { queryId: 1 } }],
      ['a panel without a query', { name: 'x', panels: [{ display: 'chart' }] }],
      ['a panel with a query id that is not a number', { name: 'x', panels: [{ queryId: '1' }] }],
      ['an unknown panel display', { name: 'x', panels: [{ queryId: 1, display: 'pie' }] }],
      ['an unknown panel width', { name: 'x', panels: [{ queryId: 1, width: 'third' }] }],
      ['a panel limit of zero', { name: 'x', panels: [{ queryId: 1, limit: 0 }] }],
      ['too many panels', { name: 'x', panels: Array.from({ length: MAX_PANELS + 1 }, () => ({ queryId: 1 })) }],
      ['parameters that are not an object', { name: 'x', panels: [], parameters: ['a'] }],
    ]) {
      it(`rejects a dashboard with ${problem}`, async function () {
        const res = await admin.create(this.frontend, body as object);
        expect(res.status).to.equal(400);
        expect(res.body.errors.length).to.be.greaterThan(0);
      });
    }

    it('rejects a body that is not JSON', async function () {
      const res = await request(this.frontend).post('/admin/analytics/api/dashboards')
        .type('form').send('name=x').use(auth({ username: ADMIN }));
      expect(res.status).to.equal(415);
    });
  });

  describe('reading dashboards', function () {
    it('lists every dashboard, most recently changed first', async function () {
      const res = await admin.list(this.frontend);
      expect(res.status).to.equal(200);
      expect(res.body.dashboards.map((d) => d.owner)).to.include.members([ADMIN, ANOTHER_ADMIN]);
      const times = res.body.dashboards.map((d) => new Date(d.updatedAt).getTime());
      expect(times).to.eql([...times].sort((a, b) => b - a));
    });

    it('gets one dashboard', async function () {
      const res = await admin.get(this.frontend, anotherId);
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ name: 'Theirs', owner: ANOTHER_ADMIN });
      expect(res.body.panels).to.eql([{ queryId: 3, display: 'chart', width: 'half', limit: null }]);
    });

    it('says when there is no such dashboard', async function () {
      expect((await admin.get(this.frontend, 999999)).status).to.equal(404);
      expect((await admin.get(this.frontend, 'nope')).status).to.equal(404);
    });
  });

  describe('changing a dashboard', function () {
    it('changes only the fields in the request', async function () {
      const res = await admin.update(this.frontend, dashboardId, { panels: [{ queryId: 2, display: 'table' }] });
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ name: 'Jobs', description: 'Jobs and work items' });
      expect(res.body.panels).to.eql([{ queryId: 2, display: 'table', width: 'half', limit: null }]);
      expect(res.body.parameters).to.eql(jobsDashboard.parameters);
    });

    it('lets an admin change another admin\'s, keeping its owner', async function () {
      const res = await admin.update(this.frontend, anotherId, { description: 'tidied up' });
      expect(res.status).to.equal(200);
      expect(res.body.owner).to.equal(ANOTHER_ADMIN);
    });

    it('rejects renaming it to the name of another of the owner\'s dashboards', async function () {
      expect((await admin.update(this.frontend, dashboardId, { name: 'Empty' })).status).to.equal(409);
    });

    it('rejects invalid changes', async function () {
      expect((await admin.update(this.frontend, dashboardId, { panels: [{ queryId: -1 }] })).status).to.equal(400);
    });
  });

  describe('deleting a dashboard', function () {
    it('deletes it', async function () {
      expect((await admin.delete(this.frontend, dashboardId)).status).to.equal(204);
      expect((await admin.get(this.frontend, dashboardId)).status).to.equal(404);
    });

    it('lets an admin delete another admin\'s', async function () {
      expect((await admin.delete(this.frontend, anotherId)).status).to.equal(204);
      expect((await admin.get(this.frontend, anotherId)).status).to.equal(404);
    });
  });
});
