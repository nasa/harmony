import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { hookAdminWorkflowUIJobRows, hookWorkflowUIJobRows } from '../helpers/workflow-ui';
import * as sinon from 'sinon';
import * as services from '../../app/models/services';
import MockDate from 'mockdate';
import * as mustache from 'mustache';



// main objects used in the tests
const boJob1 = buildJob({ status: JobStatus.FAILED, username: 'bo' });
const boJob2 = buildJob({ status: JobStatus.SUCCESSFUL, username: 'bo', service_name: 'cog-maker' });
const adamJob1 = buildJob({ status: JobStatus.RUNNING, username: 'adam' });
const woodyJob1 = buildJob({ status: JobStatus.RUNNING, username: 'woody' });

const totalJobsCount = [boJob1, boJob2, adamJob1, woodyJob1].length;

describe('Workflow UI jobs table route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  hookTransaction();
  let servicesStub: sinon.SinonStub;
  before(async function () {
    MockDate.set('1/30/2000');
    servicesStub = sinon.stub(services, 'serviceNames').value(['cog-maker', 'netcdf-to-zarr']);
    await boJob1.save(this.trx);
    await boJob2.save(this.trx);
    await adamJob1.save(this.trx);
    await woodyJob1.save(this.trx);
    this.trx.commit();
  });
  after(function () {
    servicesStub.restore();
    MockDate.reset();
  });

  describe('a user requesting SUCCESSFUL jobs', function () {
    hookWorkflowUIJobRows({ username: 'bo', jobIDs: [boJob1.jobID, boJob2.jobID], query: { tableFilter: '[{"value":"status: successful","dbValue":"successful","field":"status"}]' } });
    it('returns only the successful job row', function () {
      const response = this.res.text;
      expect(response).to.not.contain(`<tr id="job-${boJob1.jobID}" class='job-table-row'>`);
      expect(response).contains(`<tr id="job-${boJob2.jobID}" class='job-table-row'>`);
      expect((response.match(/job-table-row/g) || []).length).to.eq(1);
    });
  });

  describe('a user requesting jobs of a particular date range', function () {
    const dateKind = 'createdAt';
    const tzOffsetMinutes = 240;
    const fromDateTime = '1999-10-10T10:44';
    const toDateTime = '2023-10-20T10:45';
    hookWorkflowUIJobRows({ username: 'bo', jobIDs: [], query: { page: 1, limit: 1,
      dateKind, tzOffsetMinutes, fromDateTime, toDateTime } });
    it('includes the date filters on the paging links', function () {
      const renderedDateQuery = mustache.render('{{query}}', {
        query : `dateKind=${dateKind}` + 
          `&tzOffsetMinutes=${tzOffsetMinutes}` +
          `&fromDateTime=${encodeURIComponent(fromDateTime)}` +
          `&toDateTime=${encodeURIComponent(toDateTime)}`,
      });
      const response = this.res.text;
      expect(response).contains(renderedDateQuery);
    });
  });

  describe('an admin using a service name filter', function () {
    hookWorkflowUIJobRows({ username: 'bo', jobIDs: [boJob1.jobID, boJob2.jobID],
      query: { disallowService: false, tableFilter: '[{"value":"service: cog-maker","dbValue":"cog-maker","field":"service"}]' } });
    it('returns only the job row for the cog-maker service job', function () {
      const response = this.res.text;
      expect(response).to.not.contain(`<tr id="job-${boJob1.jobID}" class='job-table-row'>`);
      expect(response).contains(`<tr id="job-${boJob2.jobID}" class='job-table-row'>`);
      expect((response.match(/job-table-row/g) || []).length).to.eq(1);
    });
    it('returns updated (disabled) paging links', function () {
      const response = this.res.text;
      expect(response.replace(/\s/g, '')).to.contain(
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
    it('ignores the user filter and returns all jobs', function () {
      const response = this.res.text;
      expect(response).contains(`<tr id="job-${woodyJob1.jobID}" class='job-table-row'>`);
      expect((response.match(/job-table-row/g) || []).length).to.eq(totalJobsCount);
    });
  });

  describe('an admin who uses a user filter with the admin route', function () {
    hookAdminWorkflowUIJobRows({ username: 'adam', jobIDs: [woodyJob1.jobID],
      query: { disallowUser: 'on', tableFilter: '[{"value":"user: woody","dbValue":"woody","field":"user"}]' } });
    it('returns only the job rows matching the user filter', function () {
      const response = this.res.text;
      expect(response).to.not.contain(`<tr id="job-${woodyJob1.jobID}" class='job-table-row'>`);
      expect((response.match(/job-table-row/g) || []).length).to.eq(3);
    });
    it('returns updated paging links that reflect the impact of the user filter', function () {
      // the filter should filter out woody's job
      const response = this.res.text;
      expect(response).to.contain(`1-${totalJobsCount - 1} of ${totalJobsCount - 1} (page 1 of 1)`);
    });
  });

  describe('a user who  is an admin', function () {
    describe('with one page', function () {
      hookWorkflowUIJobRows({ username: 'adam', jobIDs: [boJob1.jobID, adamJob1.jobID], query: { page: 1, limit: 10 } });
      it('returns all jobs', async function () {
        const response = this.res.text;
        expect((response.match(/job-table-row/g) || []).length).to.eq(totalJobsCount);
      });
    });
    describe('with two pages', function () {
      hookWorkflowUIJobRows({ username: 'adam', jobIDs: [boJob1.jobID, adamJob1.jobID], query: { page: 1, limit: 1 } });
      it('returns updated paging links, with a link to the last and next page', function () {
        const response = this.res.text;
        expect(response.replace(/\s/g, '')).contains(
          `<nav id="page-nav" aria-label="Page navigation" class="bg-white d-flex flex-column align-items-center py-2 sticky-paging">
            <ul class="pagination px-0 mx-auto mb-1">
                <li class="page-item disabled">
                    <a class="page-link" href="" title="first">first</a>
                </li>
                <li class="page-item disabled">
                    <a class="page-link" href="" title="previous">previous</a>
                </li>
                <li class="page-item ">
                    <a class="page-link" href="http:&#x2F;&#x2F;127.0.0.1:4000&#x2F;workflow-ui?page&#x3D;2&amp;limit&#x3D;1" title="next">next</a>
                </li>
                <li class="page-item ">
                    <a class="page-link" href="http:&#x2F;&#x2F;127.0.0.1:4000&#x2F;workflow-ui?page&#x3D;4&amp;limit&#x3D;1" title="last">last</a>
                </li>
            </ul>
            <small class="text-muted">
                1-1 of ${totalJobsCount} (page 1 of ${totalJobsCount})
            </small>
        </nav>`.replace(/\s/g, ''),
        );
      });
    });
    describe('with all nonterminal jobs selected', function () {
      hookWorkflowUIJobRows({ username: 'adam', jobIDs: [woodyJob1.jobID, adamJob1.jobID], query: { page: 1, limit: 10 } });
      it('returns the select all jobs checkbox checked', async function () {
        const response = this.res.text;
        expect(response).contains('<input id="select-jobs" type="checkbox" title="select/deselect all jobs" autocomplete="off" checked>');
      });
      it('has all select job checkboxes checked', function () {
        const response = this.res.text;
        expect(response).contains(`<input id="select-${woodyJob1.jobID}" class="select-job" type="checkbox" data-id="${woodyJob1.jobID}" data-status="${woodyJob1.status}" autocomplete="off" checked>`);
        expect(response).contains(`<input id="select-${adamJob1.jobID}" class="select-job" type="checkbox" data-id="${adamJob1.jobID}" data-status="${adamJob1.status}" autocomplete="off" checked>`);
      });
    });
    describe('with 1 nonterminal job selected and one nonterminal job not selected', function () {
      hookWorkflowUIJobRows({ username: 'adam', jobIDs: [woodyJob1.jobID], query: { page: 1, limit: 10 } });
      it('returns the select all jobs checkbox unchecked', async function () {
        const response = this.res.text;
        expect(response).contains('<input id="select-jobs" type="checkbox" title="select/deselect all jobs" autocomplete="off" >');
      });
      it('has one job checkbox checked', async function () {
        const response = this.res.text;
        expect(response).contains(`<input id="select-${woodyJob1.jobID}" class="select-job" type="checkbox" data-id="${woodyJob1.jobID}" data-status="${woodyJob1.status}" autocomplete="off" checked>`);
      });
      it('has one job checkbox unchecked', async function () {
        const response = this.res.text;
        expect(response).contains(`<input id="select-${adamJob1.jobID}" class="select-job" type="checkbox" data-id="${adamJob1.jobID}" data-status="${adamJob1.status}" autocomplete="off" >`);
      });
    });
  });

  describe('a user who requests someone else\'s job (but is NOT an admin)', function () {
    hookWorkflowUIJobRows({ username: 'bo', jobIDs: [adamJob1.jobID] });
    it('returns only their own jobs', async function () {
      const response = this.res.text;
      expect(response).to.contain(`<tr id="job-${boJob1.jobID}" class='job-table-row'>`);
      expect(response).to.contain(`<tr id="job-${boJob2.jobID}" class='job-table-row'>`);
      expect((response.match(/job-table-row/g) || []).length).to.eq(2);
    });
  });
});
