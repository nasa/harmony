import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import request from 'supertest';

import { hookRequest } from './helpers/hooks';
import { buildJob } from './helpers/jobs';
import hookServersStartStop from './helpers/servers';
import { hookTransaction, tables, truncateAll } from '../../../packages/util/test/helpers/db';
import { JobStatus } from '../app/models/job';

const logoutLink = '<a class="nav-link" href="/oauth2/logout">Logout</a>';
const errorPageLogoutLink = '<a class="logout" href="/oauth2/logout">Logout</a>';
const swaggerLogoutScript = '/js/docs/logout-link.js';

const job = buildJob({
  username: 'woody',
  status: JobStatus.SUCCESSFUL,
  message: 'Completed successfully',
  progress: 100,
  links: [],
  request: 'http://example.com/harmony?request=woody1',
  isAsync: true,
  numInputGranules: 3,
});

/**
 * Returns a function that makes a GET request for an HTML page at the given path
 *
 * @param path - The path to request
 * @returns A function that makes the request
 */
function htmlPage(path: string | (() => string)): Function {
  return (app): request.Test => request(app)
    .get(typeof path === 'string' ? path : path())
    .set('Accept', 'text/html')
    .redirects(0);
}

describe('Logout links', function () {
  describe('when using the Earthdata Login client app', function () {
    hookServersStartStop({ USE_EDL_CLIENT_APP: true });
    hookTransaction();

    before(async function () {
      await Promise.all(tables.map((t) => this.trx(t).truncate()));
      await job.save(this.trx);
      this.trx.commit();
    });

    after(async function () {
      await truncateAll();
    });

    const pages = [
      { name: 'the landing page', path: '/' },
      { name: 'the documentation page', path: '/docs' },
      { name: 'the workflow UI jobs page', path: '/workflow-ui' },
      { name: 'the workflow UI job page', path: (): string => `/workflow-ui/${job.jobID}` },
      { name: 'the admin workflow UI jobs page', path: '/admin/workflow-ui?tableFilter=[]', username: 'adam' },
      { name: 'the admin workflow UI job page', path: (): string => `/admin/workflow-ui/${job.jobID}`, username: 'adam' },
      { name: 'the admin dashboard', path: '/admin/dashboard', username: 'adam' },
      { name: 'the admin retry statistics page', path: '/admin/retry-stats', username: 'adam' },
    ];

    for (const { name, path, username } of pages) {
      describe(`when a logged-in user views ${name}`, function () {
        hookRequest(htmlPage(path), { username: username || 'woody' });

        it('returns the HTML page', function () {
          expect(this.res.statusCode).to.equal(200);
          expect(this.res.get('Content-Type')).to.equal('text/html; charset=utf-8');
        });

        it('includes a logout link', function () {
          expect(this.res.text).to.include(logoutLink);
        });
      });
    }

    for (const { name, path } of pages.slice(0, 2)) {
      describe(`when a user who is not logged in views ${name}`, function () {
        hookRequest(htmlPage(path));

        it('returns the HTML page', function () {
          expect(this.res.statusCode).to.equal(200);
        });

        it('does not include a logout link', function () {
          expect(this.res.text).to.not.include('/oauth2/logout');
        });
      });
    }

    for (const path of ['/docs/api/', '/docs/edr-api/', '/docs/capabilities-api/']) {
      describe(`when a logged-in user views the Swagger UI page at ${path}`, function () {
        hookRequest(htmlPage(path), { username: 'woody' });

        it('includes the script that adds a logout link', function () {
          expect(this.res.statusCode).to.equal(200);
          expect(this.res.text).to.include(swaggerLogoutScript);
        });

        it('still includes the analytics script', function () {
          expect(this.res.text).to.include('/js/docs/analytics-tag.js');
        });
      });

      describe(`when a user who is not logged in views the Swagger UI page at ${path}`, function () {
        hookRequest(htmlPage(path));

        it('does not include the script that adds a logout link', function () {
          expect(this.res.statusCode).to.equal(200);
          expect(this.res.text).to.not.include(swaggerLogoutScript);
        });

        it('still includes the analytics script', function () {
          expect(this.res.text).to.include('/js/docs/analytics-tag.js');
        });
      });
    }

    describe('when a logged-in user gets an HTML error page', function () {
      hookRequest(htmlPage('/admin/dashboard'), { username: 'woody' });

      it('returns the HTML error page', function () {
        expect(this.res.statusCode).to.equal(403);
        expect(this.res.get('Content-Type')).to.equal('text/html; charset=utf-8');
      });

      it('includes a logout link', function () {
        expect(this.res.text).to.include(errorPageLogoutLink);
      });
    });

    describe('when a user who is not logged in gets an HTML error page', function () {
      hookRequest(htmlPage('/not-a-real-page'));

      it('returns the HTML error page', function () {
        expect(this.res.statusCode).to.equal(404);
        expect(this.res.get('Content-Type')).to.equal('text/html; charset=utf-8');
      });

      it('does not include a logout link', function () {
        expect(this.res.text).to.not.include('/oauth2/logout');
      });
    });
  });

  describe('when skipping the Earthdata Login client app', function () {
    hookServersStartStop({ USE_EDL_CLIENT_APP: false });

    describe('when a user with a session cookie views the landing page', function () {
      hookRequest(htmlPage('/'), { username: 'woody' });

      it('returns the HTML page', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('does not include a logout link, since there is no session to log out of', function () {
        expect(this.res.text).to.not.include('/oauth2/logout');
      });
    });
  });
});
