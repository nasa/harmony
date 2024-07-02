import * as mustache from 'mustache';
import { expect } from 'chai';
import request from 'supertest';
import { describe, it, before } from 'mocha';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { workflowUIJobs, hookWorkflowUIJobs, hookAdminWorkflowUIJobs } from '../helpers/workflow-ui';
import env from '../../app/util/env';
import { auth } from '../helpers/auth';
import { renderNavLink } from './helpers';
import MockDate from 'mockdate';


// Example jobs to use in tests
const woodyJob1 = buildJob({
  username: 'woody',
  status: JobStatus.SUCCESSFUL,
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1', rel: 'link', type: 'text/plain' }],
  request: 'http://example.com/harmony?request=woody1&turbo=false',
  isAsync: true,
  numInputGranules: 89723,
  service_name: 'harmony/service-example',
  provider_id: 'provider_a',
});

const woodyJob2 = buildJob({
  username: 'woody',
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 60,
  links: [{ href: 's3://somebucket/mydata', rel: 'data', type: 'image/tiff' }],
  request: 'http://example.com/harmony?request=woody2&turbo=true',
  isAsync: true,
  numInputGranules: 35051,
  service_name: 'harmony/service-example',
  provider_id: 'provider_a',
});

const woodySyncJob = buildJob({
  username: 'woody',
  status: JobStatus.FAILED,
  message: 'The job failed :(',
  progress: 0,
  links: [],
  request: 'http://example.com/harmony?request=woody2',
  isAsync: false,
  numInputGranules: 12615,
  service_name: 'harmony/netcdf-to-zarr',
  provider_id: 'provider_b',
});

const buzzJob1 = buildJob({
  username: 'buzz',
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 30,
  links: [],
  request: 'http://example.com/harmony?request=buzz1&turbo=true',
  isAsync: true,
  numInputGranules: 10,
  provider_id: 'provider_1',
});

const sidJob1 = buildJob({
  username: 'sid',
  status: JobStatus.RUNNING_WITH_ERRORS,
  provider_id: 'provider_1',
});

const sidJob2 = buildJob({
  username: 'sid',
  status: JobStatus.COMPLETE_WITH_ERRORS,
  provider_id: 'provider_2',
});

const sidJob3 = buildJob({
  username: 'sid',
  status: JobStatus.PAUSED,
  provider_id: 'provider_3',
});

const sidJob4 = buildJob({
  username: 'sid',
  status: JobStatus.PREVIEWING,
  provider_id: 'provider_q',
});

describe('Workflow UI jobs route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  before(async function () {
    await truncateAll();
  });

  after(async function () {
    await truncateAll();
  });

  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await workflowUIJobs(this.frontend).redirects(0);
    });

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/workflow-ui'));
    });
  });

  describe('For a logged-in user', function () {
    hookTransaction();
    before(async function () {
      // Add all jobs to the database
      MockDate.set('2023-01-04T14:12:00.000Z');
      await woodyJob1.save(this.trx);
      MockDate.set('2023-01-05T14:12:00.000Z');
      await woodyJob2.save(this.trx);
      MockDate.set('2023-01-06T14:12:00.000Z');
      await woodySyncJob.save(this.trx);

      await buzzJob1.save(this.trx);

      await sidJob1.save(this.trx);
      await sidJob2.save(this.trx);
      await sidJob3.save(this.trx);
      await sidJob4.save(this.trx);

      this.trx.commit();
      MockDate.reset();
    });

    describe('When including a trailing slash on the user route /workflow-ui/', function () {
      before(async function () {
        this.res = await request(this.frontend).get('/workflow-ui/').use(auth({ username: 'andy' })).redirects(0);
      });

      it('redirects to the /workflow-ui page without a trailing slash', function () {
        expect(this.res.statusCode).to.equal(301);
        expect(this.res.headers.location).to.match(/.*\/workflow-ui$/);
      });
    });

    describe('who has no jobs', function () {
      hookWorkflowUIJobs({ username: 'andy' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an empty jobs table', function () {
        expect(this.res.text).to.not.contain('job-table-row');
      });

      it('contains the right paging info', function () {
        expect(this.res.text).to.contain('0-0 of 0 (page 1 of 1)');
      });
    });

    describe('who has jobs', function () {
      hookWorkflowUIJobs({ username: 'woody' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an HTML table of info regarding the user\'s jobs', function () {
        const listing = this.res.text;
        [woodyJob1.request, woodyJob2.request, woodySyncJob.request]
          .forEach((req) => expect(listing).to.contain(mustache.render('{{req}}', { req })));
        expect((listing.match(/job-table-row/g) || []).length).to.equal(3);
      });

      it('does not return jobs for other users', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain(mustache.render('{{req}}', { req: buzzJob1.request }));
      });
    });

    describe('who has 0 jobs', function () { 
      hookWorkflowUIJobs({ username: 'eve' });
      it('the paging descriptor makes sense', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(0);
        expect(listing).to.contain('0-0 of 0 (page 1 of 1)');
      });
    });

    describe('who filters jobs by update date >=', function () {
      hookWorkflowUIJobs({ username: 'woody', tzoffsetminutes: '0', fromdatetime: '2023-01-06T14:12', datekind: 'updatedAt' });
      it('returns the job with an acceptable updatedAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-06T14:12:00.000Z')).getTime());
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who filters jobs by update date >= with a timezone offset of -1 hour', function () {
      hookWorkflowUIJobs({ username: 'woody', tzoffsetminutes: '60', fromdatetime: '2023-01-06T13:12', datekind: 'updatedAt' });
      it('returns the job with an acceptable updatedAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-06T14:12:00.000Z')).getTime());
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who filters jobs by update date >= with a timezone offset of +1 hour', function () {
      hookWorkflowUIJobs({ username: 'woody', tzoffsetminutes: '-60', fromdatetime: '2023-01-06T15:12', datekind: 'updatedAt' });
      it('returns the job with an acceptable updatedAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-06T14:12:00.000Z')).getTime());
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
      it('carries over the date filters to the job link url', function () {
        const listing = this.res.text;
        const dateQuery = `?fromDateTime=${encodeURIComponent('2023-01-06T15:12')}&toDateTime=` +
          '&dateKind=updatedAt&tzOffsetMinutes=-60';
        expect(listing).to.contain(mustache.render('{{dateQuery}}', { dateQuery }));
      });
    });

    describe('who filters jobs by created date >= and <=', function () {
      hookWorkflowUIJobs({ username: 'woody', tzoffsetminutes: '0',
        fromdatetime: '2023-01-05T14:12', todatetime: '2023-01-05T14:12', datekind: 'createdAt' });
      it('returns the job with an acceptable createdAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-05T14:12:00.000Z')).getTime());
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who filters jobs by created date <=', function () {
      hookWorkflowUIJobs({ username: 'woody', tzoffsetminutes: '0', todatetime: '2023-01-05T14:12', datekind: 'createdAt' });
      it('returns the jobs with acceptable createdAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-05T14:12:00.000Z')).getTime());
        expect(listing).to.contain((new Date('2023-01-04T14:12:00.000Z')).getTime());
        expect((listing.match(/job-table-row/g) || []).length).to.equal(2);
      });
    });

    describe('who has 3 jobs and asks for page 1, with a limit of 1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1 });
      it('returns a link to the next page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=2', 'next'));
      });
      it('returns a disabled link to the previous page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'previous', false));
      });
      it('returns a disabled link to the first page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'first', false));
      });
      it('returns a link to the last page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=3', 'last'));
      });
      it('returns only one job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
      it('sets the page limit input to the expected value', function () {
        const listing = this.res.text;
        expect(listing).to.contain('<input name="limit" type="number" class="form-control" value="1">');
      });
    });

    describe('who asks for page 1, with a limit of 1, descending', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, sortGranules: 'desc' });
      it('returns the largest job', function () {
        const listing = this.res.text;
        expect(listing).to.contain('89723');
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who asks for page 1, with a limit of 1, ascending', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, sortGranules: 'asc' });
      it('returns the smallest job', function () {
        const listing = this.res.text;
        expect(listing).to.contain('12615');
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who sets the limit to 0', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 0 });
      it('the backend sets the page limit to 1', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        expect(listing).to.contain('1-1 of 3 (page 1 of 3)');
        expect(listing).to.contain(mustache.render('<input name="limit" type="number" class="form-control" value="1">', {}));
      });
    });

    describe('who sets the limit to -1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: -1 });
      it('the backend sets the page limit to 1', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        expect(listing).to.contain('1-1 of 3 (page 1 of 3)');
        expect(listing).to.contain(mustache.render('<input name="limit" type="number" class="form-control" value="1">', {}));
      });
    });

    describe('who asks for more than env.maxPageSize jobs', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: env.maxPageSize + 999 });
      it('returns all of the users jobs without error', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(3);
      });
    });

    describe('who has 3 jobs and asks for page 2, with a limit of 1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, page: 2 });
      it('returns a link to the next and previous page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=1', 'previous'));
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=3', 'next'));
      });
      it('returns a link to the first page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=1', 'first', true));
      });
      it('returns a link to the last page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=3', 'last', true));
      });
      it('returns only one job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
      it('contains paging info', function () {
        const listing = this.res.text;
        expect(listing).to.contain('2-2 of 3 (page 2 of 3)');
      });
    });

    describe('who has 3 jobs and asks for page 3, with a limit of 1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, page: 3 });
      it('returns a disabled link to the next page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'next', false));
      });
      it('returns a link to the previous page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=2', 'previous'));
      });
      it('returns a link to the first page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=1', 'first'));
      });
      it('returns a disabled link to the last page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'last', false));
      });
      it('returns only one job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who filters by status IN [failed]', function () {
      hookWorkflowUIJobs({ username: 'woody', tableFilter: '[{"value":"status: failed","dbValue":"failed","field":"status"}]' });
      it('returns only failed jobs', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does not have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.not.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('who filters by status IN [failed, successful]', function () {
      const tableFilter = '[{"value":"status: failed","dbValue":"failed","field":"status"},{"value":"status: successful","dbValue":"successful","field":"status"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowStatus: '', tableFilter });
      it('returns failed and successful jobs', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(2);
        expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does not have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('who filters by an invalid status (working)', function () {
      hookWorkflowUIJobs({ username: 'woody', tableFilter: '[{"value":"status: working","dbValue":"working","field":"status"}, {"value":"status: running","dbValue":"running","field":"status"}]' });
      it('ignores the invalid status', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain('status: working');
        expect(listing).to.contain('status: running');
      });
    });

    describe('who filters by an invalid username (jo)', function () {
      hookAdminWorkflowUIJobs({ username: 'adam', tableFilter: '[{"value":"user: jo"}, {"value":"user: woody"}]' });
      it('ignores the invalid username', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain('user: jo');
        expect(listing).to.contain('user: woody');
      });
    });

    describe('who filters by status NOT IN [failed, successful]', function () {
      const tableFilter = '[{"value":"status: failed","dbValue":"failed","field":"status"},{"value":"status: successful","dbValue":"successful","field":"status"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowStatus: 'on', tableFilter });
      it('returns all jobs that are not failed or successful', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        expect(listing).to.not.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?=.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('who filters by service IN [harmony/service-example]', function () {
      const tableFilter = '[{"value":"service: harmony/service-example","dbValue":"harmony/service-example","field":"service"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowService: '', tableFilter });
      it('returns jobs for harmony/service-example', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(2);
        const serviceExampleTd = mustache.render('<td>{{service}}</td>', { service: 'harmony/service-example' });
        const serviceExampleRegExp = new RegExp(serviceExampleTd, 'g');
        expect((listing.match(serviceExampleRegExp) || []).length).to.equal(2);
        const netcdfToZarrTd = mustache.render('<td>{{service}}</td>', { service: 'harmony/netcdf-to-zarr' });
        const netcdfToZarrRegExp = new RegExp(netcdfToZarrTd, 'g');
        expect((listing.match(netcdfToZarrRegExp) || []).length).to.equal(0);
      });
      it('does not have disallowService HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowService")(?!.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate services selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain(mustache.render('{{service}}', { service: 'service: harmony/service-example' }));
      });
    });

    describe('who filters by service NOT IN [harmony/service-example]', function () {
      const tableFilter = '[{"value":"service: harmony/service-example","dbValue":"harmony/service-example","field":"service"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowService: 'on', tableFilter });
      it('returns jobs for harmony/netcdf-to-zarr', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        const serviceExampleTd = mustache.render('<td>{{service}}</td>', { service: 'harmony/service-example' });
        const serviceExampleRegExp = new RegExp(serviceExampleTd, 'g');
        expect((listing.match(serviceExampleRegExp) || []).length).to.equal(0);
        const netcdfToZarrTd = mustache.render('<td>{{service}}</td>', { service: 'harmony/netcdf-to-zarr' });
        const netcdfToZarrRegExp = new RegExp(netcdfToZarrTd, 'g');
        expect((listing.match(netcdfToZarrRegExp) || []).length).to.equal(1);
      });
      it('does have disallowService HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowService")(?=.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate services selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain(mustache.render('{{service}}', { service: 'service: harmony/service-example' }));
      });
    });

    describe('who filters by provider, but is not an admin', function () {
      const tableFilter = '[{"value":"provider: provider_z","dbValue":"provider_z","field":"provider"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowProvider: 'on', tableFilter });
      it('ignores the provider filter, returning all of woody\'s jobs', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(3);
      });
      it('does not return the disallowProvider HTML checkbox', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowProvider").*>/g) || []).length).to.equal(0);
      });
      it('has no provider filters selected', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain(mustache.render('{{prov}}', { provider: 'provider: prov_a' }));
      });
    });

    describe('who filters by a particular combination of filter types', function () {
      const tableFilter = '[{"value":"service: harmony/service-example","dbValue":"harmony/service-example","field":"service"},{"value":"status: failed","dbValue":"failed","field":"status"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowService: 'on', disallowStatus: '', tableFilter });
      it('returns the harmony/netcdf-to-zarr job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        const serviceExampleTd = mustache.render('<td>{{service}}</td>', { service: 'harmony/service-example' });
        const serviceExampleRegExp = new RegExp(serviceExampleTd, 'g');
        expect((listing.match(serviceExampleRegExp) || []).length).to.equal(0);
        const netcdfToZarrTd = mustache.render('<td>{{service}}</td>', { service: 'harmony/netcdf-to-zarr' });
        const netcdfToZarrRegExp = new RegExp(netcdfToZarrTd, 'g');
        expect((listing.match(netcdfToZarrRegExp) || []).length).to.equal(1);

        expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('has the appropriate HTML (un)checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
        expect((listing.match(/<input (?=.*name="disallowService")(?=.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate filters selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain(mustache.render('{{service}}', { service: 'service: harmony/service-example' }));
        expect(listing).to.contain(mustache.render('{{status}}', { status: 'status: failed' }));
      });
    });

    describe('when accessing the admin endpoint', function () {
      describe('when the user is part of the admin group', function () {
        describe('When including a trailing slash on the admin route admin/workflow-ui/', function () {
          before(async function () {
            this.res = await request(this.frontend).get('/admin/workflow-ui/').use(auth({ username: 'adam' })).redirects(0);
          });

          it('redirects to the /admin/workflow-ui page without a trailing slash', function () {
            expect(this.res.statusCode).to.equal(301);
            expect(this.res.headers.location).to.match(/.*\/admin\/workflow-ui$/);
          });
        });

        hookAdminWorkflowUIJobs({ username: 'adam', limit: 100 });
        it('returns jobs for all users', async function () {
          const listing = this.res.text;
          [woodyJob1.request, woodyJob2.request, woodySyncJob.request, buzzJob1.request]
            .forEach((req) => expect(listing).to.contain(mustache.render('{{req}}', { req })));
          expect((listing.match(/job-table-row/g) || []).length).to.equal(8);
        });

        it('shows the users that submitted those jobs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain('<td>woody</td>');
          expect(listing).to.contain('<td>buzz</td>');
        });
      });

      describe('when the admin filters the jobs by user IN [woody]', function () {
        hookAdminWorkflowUIJobs({ username: 'adam', tableFilter: '[{"value":"user: woody"}]' });
        it('only contains jobs submitted by woody', async function () {
          const listing = this.res.text;
          expect(listing).to.contain('<td>woody</td>');
          expect(listing).to.not.contain('<td>buzz</td>');
        });
      });

      describe('when the admin filters the jobs by user NOT IN [woody]', function () {
        hookAdminWorkflowUIJobs({ username: 'adam', tableFilter: '[{"value":"user: woody"}]', disallowUser: 'on' });
        it('does not contain jobs submitted by woody', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain('<td>woody</td>');
          expect(listing).to.contain('<td>buzz</td>');
        });
      });

      describe('when the admin filters by status IN [running_with_errors, complete_with_errors, paused, previewing]', function () {
        const tableFilter = '[{"value":"status: running with errors","dbValue":"running_with_errors","field":"status"},' +
        '{"value":"status: complete with errors","dbValue":"complete_with_errors","field":"status"},' +
        '{"value":"status: paused","dbValue":"paused","field":"status"},' +
        '{"value":"status: previewing","dbValue":"previewing","field":"status"}]';
        hookAdminWorkflowUIJobs({ username: 'adam', disallowStatus: '', tableFilter });
        it('returns jobs with the aforementioned statuses', function () {
          const listing = this.res.text;
          expect((listing.match(/job-table-row/g) || []).length).to.equal(4);
          expect(listing).to.contain(`<span class="badge bg-warning">${JobStatus.RUNNING_WITH_ERRORS.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-success">${JobStatus.COMPLETE_WITH_ERRORS.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-warning">${JobStatus.PAUSED.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-info">${JobStatus.PREVIEWING.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
        });
        it('does not have disallowStatus HTML checked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
        });
        it('has the appropriate status options selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain('status: running with errors');
          expect(listing).to.contain('status: complete with errors');
          expect(listing).to.contain('status: paused');
          expect(listing).to.contain('status: previewing');
          expect(listing).to.not.contain('status: failed');
          expect(listing).to.not.contain('status: successful');
        });
      });

      describe('when the admin filters by status NOT IN [running_with_errors, complete_with_errors, paused, previewing]', function () {
        const tableFilter = '[{"value":"status: running with errors","dbValue":"running_with_errors","field":"status"},' +
        '{"value":"status: complete with errors","dbValue":"complete_with_errors","field":"status"},' +
        '{"value":"status: paused","dbValue":"paused","field":"status"},' +
        '{"value":"status: previewing","dbValue":"previewing","field":"status"}]';
        hookAdminWorkflowUIJobs({ username: 'adam', disallowStatus: 'on', tableFilter });
        it('returns jobs without the aforementioned statuses', function () {
          const listing = this.res.text;
          expect((listing.match(/job-table-row/g) || []).length).to.equal(4);
          expect(listing).to.not.contain(`<span class="badge bg-warning">${JobStatus.RUNNING_WITH_ERRORS.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.COMPLETE_WITH_ERRORS.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-warning">${JobStatus.PAUSED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.PREVIEWING.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
        });
        it('does have disallowStatus HTML checked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowStatus")(?=.*checked).*>/g) || []).length).to.equal(1);
        });
        it('has the appropriate status options selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain('status: running with errors');
          expect(listing).to.contain('status: complete with errors');
          expect(listing).to.contain('status: paused');
          expect(listing).to.contain('status: previewing');
          expect(listing).to.not.contain('status: failed');
          expect(listing).to.not.contain('status: successful');
        });
      });

      describe('and the admin filters by provider IN [provider_b]', function () {
        const tableFilter = '[{"value":"provider: provider_b","dbValue":"provider_b","field":"provider"}]';
        hookAdminWorkflowUIJobs({ username: 'adam', disallowProvider: '', tableFilter });
        it('returns the matching job', function () {
          const listing = this.res.text;
          expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        });
        it('returns the disallowProvider HTML checkbox unchecked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowProvider")(?!.*checked).*>/g) || []).length).to.equal(1);
          expect((listing.match(/<input (?=.*name="disallowProvider")(?=.*checked).*>/g) || []).length).to.equal(0);
        });
        it('has the provider filter selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{prov}}', { provider: 'provider: provider_b' }));
        });
      });

      describe('and the admin filters by provider NOT IN [provider_b, provider_z]', function () {
        const tableFilter = '[{"value":"provider: provider_b","dbValue":"provider_b","field":"provider"},{"value":"provider: provider_z","dbValue":"provider_z","field":"provider"}]';
        hookAdminWorkflowUIJobs({ username: 'adam', disallowProvider: 'on', tableFilter });
        it('returns the jobs that do not match providers b and z', function () {
          const listing = this.res.text;
          expect((listing.match(/job-table-row/g) || []).length).to.equal(7);
          expect(listing).to.not.contain(mustache.render('{{req}}', { req: woodySyncJob.jobID }));
        });
        it('returns the disallowProvider HTML checkbox checked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowProvider")(?!.*checked).*>/g) || []).length).to.equal(0);
          expect((listing.match(/<input (?=.*name="disallowProvider")(?=.*checked).*>/g) || []).length).to.equal(1);
        });
        it('has the provider b and z filters selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{prov}}', { provider: 'provider: provider_b' }));
          expect(listing).to.contain(mustache.render('{{prov}}', { provider: 'provider: provider_z' }));
        });
      });

      describe('who filters by a particular combination of filter types', function () {
        const tableFilter = '[{"value":"service: harmony/netcdf-to-zarr","dbValue":"harmony/netcdf-to-zarr","field":"service"},{"value":"user: woody","dbValue":"woody","field":"user"},{"value":"provider: provider_b","dbValue":"provider_b","field":"provider"}]';
        hookAdminWorkflowUIJobs({ username: 'adam', tableFilter });
        it('returns the harmony/netcdf-to-zarr job', function () {
          const listing = this.res.text;
          console.log(listing);
          expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
          const serviceExampleTd = mustache.render('<td>{{service}}</td>', { service: 'harmony/service-example' });
          const serviceExampleRegExp = new RegExp(serviceExampleTd, 'g');
          expect((listing.match(serviceExampleRegExp) || []).length).to.equal(0);
          const netcdfToZarrTd = mustache.render('<td>{{service}}</td>', { service: 'harmony/netcdf-to-zarr' });
          const netcdfToZarrRegExp = new RegExp(netcdfToZarrTd, 'g');
          expect((listing.match(netcdfToZarrRegExp) || []).length).to.equal(1);
  
          expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
        });
        it('has the appropriate HTML (un)checked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowUser")(?!.*checked).*>/g) || []).length).to.equal(1);
          expect((listing.match(/<input (?=.*name="disallowService")(?!=.*checked).*>/g) || []).length).to.equal(1);
          expect((listing.match(/<input (?=.*name="disallowProvider")(?!.*checked).*>/g) || []).length).to.equal(1);
        });
        it('has the appropriate filters selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{service}}', { service: 'service: harmony/netcdf-to-zarr' }));
          expect(listing).to.contain(mustache.render('{{user}}', { user: 'user: woody' }));
          expect(listing).to.contain(mustache.render('{{provider}}', { provider: 'provider: provider_b' }));
        });
      });

      describe('when the user is not part of the admin group', function () {
        hookAdminWorkflowUIJobs({ username: 'eve' });
        it('returns an error', function () {
          expect(this.res.statusCode).to.equal(403);
          expect(this.res.text).to.include('You are not permitted to access this resource');
        });
      });
    });
  });
});
