import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { hookAdminWorkflowUIJobRows, hookWorkflowUIJobRows } from '../helpers/workflow-ui';
import * as sinon from 'sinon';
import * as services from '../../app/models/services';


// main objects used in the tests
const boJob1 = buildJob({ status: JobStatus.FAILED, username: 'bo' });
const boJob2 = buildJob({ status: JobStatus.SUCCESSFUL, username: 'bo', service_name: 'cog-maker' });
const adamJob1 = buildJob({ status: JobStatus.RUNNING, username: 'adam' });
const woodyJob1 = buildJob({ status: JobStatus.RUNNING, username: 'woody' });

const totalJobsCount = [boJob1, boJob2, adamJob1, woodyJob1].length;

describe('Workflow UI job table rows route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  hookTransaction();
  let servicesStub: sinon.SinonStub;
  before(async function () {
    servicesStub = sinon.stub(services, 'serviceNames').value(['cog-maker', 'netcdf-to-zarr']);
    await boJob1.save(this.trx);
    await boJob2.save(this.trx);
    await adamJob1.save(this.trx);
    await woodyJob1.save(this.trx);
    this.trx.commit();
  });
  after(function () {
    servicesStub.restore();
  });

  describe('with an invalid job ID format', function () {
    hookWorkflowUIJobRows({ jobIDs: ['not-a-uuid'], username: 'bo' });
    it('returns an error', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Invalid format for Job ID \'not-a-uuid\'. Job ID must be a UUID.',
      });
    });
  });

  describe('a user requesting SUCCESSFUL jobs', function () {
    hookWorkflowUIJobRows({ username: 'bo', jobIDs: [boJob1.jobID, boJob2.jobID], query: { tableFilter: '[{"value":"status: successful","dbValue":"successful","field":"status"}]' } });
    it('returns only the successful job row', function () {
      const response = JSON.parse(this.res.text);
      expect(response.rows[boJob1.jobID]).to.eq(undefined);
      expect(response.rows[boJob2.jobID]).contains(`<tr id="job-${boJob2.jobID}" class='job-table-row'>`);
      expect(Object.keys(response.rows).length).to.eq(1);
    });
  });

  describe('an admin using a service name filter', function () {
    hookWorkflowUIJobRows({ username: 'bo', jobIDs: [boJob1.jobID, boJob2.jobID],
      query: { disallowService: false, tableFilter: '[{"value":"service: cog-maker","dbValue":"cog-maker","field":"service"}]' } });
    it('returns only the job row for the cog-maker service job', function () {
      const response = JSON.parse(this.res.text);
      expect(response.rows[boJob1.jobID]).to.eq(undefined);
      expect(response.rows[boJob2.jobID]).contains(`<tr id="job-${boJob2.jobID}" class='job-table-row'>`);
      expect(Object.keys(response.rows).length).to.eq(1);
    });
    it('returns updated (disabled) paging links', function () {
      const response = JSON.parse(this.res.text);
      expect(response.nav.replace(/\s/g, '')).to.eq(
        `<nav id="page-nav" aria-label="Page navigation" class="bg-white d-flex flex-column align-items-center py-2 sticky-paging">
          <ul class="pagination px-0 mx-auto mb-1">
              <li class="page-item disabled">
                  <a class="page-link" href="" title="first">first</a>
              </li>
              <li class="page-item disabled">
                  <a class="page-link" href="" title="previous">previous</a>
              </li>
              <li class="page-item disabled">
                  <a class="page-link" href="" title="next">next</a>
              </li>
              <li class="page-item disabled">
                  <a class="page-link" href="" title="last">last</a>
              </li>
          </ul>
          <small class="text-muted">
              1-1 of 1 (page 1 of 1)
          </small>
        </nav>`.replace(/\s/g, ''),
      );
    });
  });

  describe('an admin using a user filter with the non-admin route', function () {
    hookWorkflowUIJobRows({ username: 'adam', jobIDs: [woodyJob1.jobID],
      query: { disallowUser: true, tableFilter: '[{"value":"user: woody","dbValue":"woody","field":"user"}]' } });
    it('ignores the user filter', function () {
      const response = JSON.parse(this.res.text);
      expect(response.rows[woodyJob1.jobID]).contains(`<tr id="job-${woodyJob1.jobID}" class='job-table-row'>`);
      expect(Object.keys(response.rows).length).to.eq(1);
    });
  });

  describe('an admin who uses a user filter with the admin route', function () {
    hookAdminWorkflowUIJobRows({ username: 'adam', jobIDs: [woodyJob1.jobID],
      query: { disallowUser: 'on', tableFilter: '[{"value":"user: woody","dbValue":"woody","field":"user"}]' } });
    it('returns only the job row matching the user filter', function () {
      const response = JSON.parse(this.res.text);
      expect(response.rows[woodyJob1.jobID]).eq(undefined);
      expect(Object.keys(response.rows).length).to.eq(0);
    });
    it('returns updated paging links that reflect the impact of the user filter', function () {
      // the filter should filter out woody's job
      const response = JSON.parse(this.res.text);
      expect(response.nav).to.contain(`1-${totalJobsCount - 1} of ${totalJobsCount - 1} (page 1 of 1)`);
    });
  });

  describe('a user whose request includes someone else\'s job (but is an admin)', function () {
    describe('with one page', function () {
      hookWorkflowUIJobRows({ username: 'adam', jobIDs: [boJob1.jobID, adamJob1.jobID], query: { page: 1, limit: 10 } });
      it('returns the other user\'s job rows in addition to their own', async function () {
        const response = JSON.parse(this.res.text);
        expect(response.rows[adamJob1.jobID]).contains(`<tr id="job-${adamJob1.jobID}" class='job-table-row'>`);
        expect(response.rows[boJob1.jobID]).contains(`<tr id="job-${boJob1.jobID}" class='job-table-row'>`);
        expect(Object.keys(response.rows).length).to.eq(2);
      });
    });
    describe('with two pages', function () {
      it('returns the other user\'s job rows in addition to their own', async function () {
        const response = JSON.parse(this.res.text);
        expect(response.rows[adamJob1.jobID]).contains(`<tr id="job-${adamJob1.jobID}" class='job-table-row'>`);
        expect(response.rows[boJob1.jobID]).contains(`<tr id="job-${boJob1.jobID}" class='job-table-row'>`);
        expect(Object.keys(response.rows).length).to.eq(2);
      });
      hookWorkflowUIJobRows({ username: 'adam', jobIDs: [boJob1.jobID, adamJob1.jobID], query: { page: 1, limit: 1 } });
      it('returns updated paging links, with a link to the last and next page', function () {
        const response = JSON.parse(this.res.text);
        expect(response.nav.replace(/\s/g, '')).to.eq(
          `<nav id="page-nav" aria-label="Page navigation" class="bg-white d-flex flex-column align-items-center py-2 sticky-paging">
            <ul class="pagination px-0 mx-auto mb-1">
                <li class="page-item disabled">
                    <a class="page-link" href="" title="first">first</a>
                </li>
                <li class="page-item disabled">
                    <a class="page-link" href="" title="previous">previous</a>
                </li>
                <li class="page-item ">
                    <a class="page-link" href="http:&#x2F;&#x2F;127.0.0.1:4000&#x2F;workflow-ui&#x2F;jobs?page&#x3D;2&amp;limit&#x3D;1" title="next">next</a>
                </li>
                <li class="page-item ">
                    <a class="page-link" href="http:&#x2F;&#x2F;127.0.0.1:4000&#x2F;workflow-ui&#x2F;jobs?page&#x3D;4&amp;limit&#x3D;1" title="last">last</a>
                </li>
            </ul>
            <small class="text-muted">
                1-1 of ${totalJobsCount} (page 1 of ${totalJobsCount})
            </small>
          </nav>`.replace(/\s/g, ''),
        );
      });
    });
  });

  describe('a user who requests someone else\'s job (but is NOT an admin)', function () {
    hookWorkflowUIJobRows({ username: 'bo', jobIDs: [adamJob1.jobID] });
    it('returns undefined', async function () {
      const response = JSON.parse(this.res.text);
      expect(response.rows[adamJob1.jobID]).to.eq(undefined);
      expect(Object.keys(response.rows).length).to.eq(0);
    });
  });
});
