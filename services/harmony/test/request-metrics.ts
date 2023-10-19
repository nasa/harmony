import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookServersStartStop from './helpers/servers';
import { hookGetRequestMetrics } from './helpers/request-metrics';
import { makePartialJobRecord, rawSaveJob } from './helpers/jobs';
import { makePartialWorkItemRecord, rawSaveWorkItem } from './helpers/work-items';
import { makePartialWorkflowStepRecord, rawSaveWorkflowStep } from './helpers/workflow-steps';
import { JobRecord } from '../app/models/job';
import { WorkItemRecord } from '../app/models/work-item-interface';
import db from '../app/util/db';
// eslint-disable-next-line node/no-missing-import
import { parse } from 'csv-parse/sync';
import { metricsFields } from '../app/frontends/request-metrics';
import { truncateAll } from './helpers/db';

const jobData = [
  // jobID, username, status, isAsync, updatedAt
  ['job1', 'Bob', 'successful', true, 12345],
  ['job2', 'Bob', 'successful', true, 12352],
  ['job3', 'Bob', 'accepted', false, 12346],
  ['job4', 'Joe', 'running', true, 12345],
  ['job5', 'Joe', 'accepted', true, 12350],
  ['job6', 'Bill', 'running', true, 12347],
  ['job7', 'Bill', 'accepted', true, 12348],
  ['job8', 'Bill', 'successful', true, 12355],
  ['job9', 'John', 'accepted', true, 12340],
  ['job10', 'Jane', 'canceled', true, 12200],
];

const workflowStepData = [
  // jobID, serviceID, operation
  ['job1', 'harmony-service-example', '[]'],
  ['job2', 'swot-reproject', '[]'],
  ['job3', 'harmony-service-example', '[]'],
  ['job4', 'harmony-service-example', '[]'],
  ['job5', 'swot-reproject', '[]'],
  ['job6', 'harmony-service-example', '[]'],
  ['job7', 'harmony-service-example', '[]'],
  ['job8', 'trajectory-subsetter', '[]'],
  ['job9', 'swot-reproject', '[]'],
  ['job10', 'harmony-service-example', '[]'],
];

const workItemData = [
  // jobID, serviceID, status, updatedAt
  ['job1', 'harmony-service-example', 'successful', 12345],
  ['job2', 'swot-reproject', 'successful', 12352],
  ['job3', 'harmony-service-example', 'ready', 12347],
  ['job4', 'harmony-service-example', 'ready', 12345],
  ['job5', 'swot-reproject', 'ready', 12350],
  ['job6', 'harmony-service-example', 'ready', 12348],
  ['job7', 'harmony-service-example', 'ready', 12349],
  ['job8', 'trajectory-subsetter', 'successful', 12355],
  ['job9', 'swot-reproject', 'ready', 12340],
  ['job10', 'harmony-service-example', 'ready', 12200],
];

describe('/admin/request-metrics', function () {
  const jobRecords = jobData.map(makePartialJobRecord);
  const workflowStepRecords = workflowStepData.map(makePartialWorkflowStepRecord);
  const workItemRecords = workItemData.map(makePartialWorkItemRecord);

  hookServersStartStop({ skipEarthdataLogin: false });

  before(truncateAll);
  after(truncateAll);

  before(async function () {
    await Promise.all(jobRecords.map(async (rec: Partial<JobRecord>) => {
      await rawSaveJob(db, rec);
    }));
    await Promise.all(workflowStepRecords.map(async (rec: Partial<JobRecord>) => {
      await rawSaveWorkflowStep(db, rec);
    }));
    await Promise.all(workItemRecords.map(async (rec: WorkItemRecord) => {
      await rawSaveWorkItem(db, rec);
    }));
  });

  describe('when the user is part of the admin group', function () {
    hookGetRequestMetrics({ username: 'adam' });
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('includes only the successful job metrics', function () {
      const records = parse(this.res.text, { columns: true, skipEmptyLines: true });
      expect(records.length).to.equal(3);
    });

    it('includes the expected columns', function () {
      const records = parse(this.res.text, { columns: true, skipEmptyLines: true });
      const columns = Object.keys(records[0]);
      expect(columns).to.eql(metricsFields);
    });
    describe('and passes in a bogus parameter', function () {
      hookGetRequestMetrics({ username: 'adam', query: { bogus: 'error' } });
      it('returns an HTTP 400 response', function () {
        const error = JSON.parse(this.res.text);
        expect(this.res.statusCode).to.equal(400);
        expect(error).to.eql({
          'code': 'harmony.RequestValidationError',
          'description': 'Error: Invalid parameter(s): bogus. Allowed parameters are: limit and page.',
        });
      });
    });

    describe('and attempts to page through the results', function () {
      describe('and requests the first page of 1 item', function () {
        hookGetRequestMetrics({ username: 'adam', query: { page: 1, limit: 1 } });
        it('returns the first item (with most recent job first)', function () {
          const records = parse(this.res.text, { columns: true, skipEmptyLines: true });
          expect(records.length).to.equal(1);
          expect(records[0].trajectorySubsetter).to.equal('1');

          // Sanity checking that services not used are set to 0
          expect(records[0].harmonyServiceExample).to.equal('0');
        });
      });

      describe('and requests the second page of 1 item', function () {
        hookGetRequestMetrics({ username: 'adam', query: { page: 2, limit: 1 } });
        it('returns the second item', function () {
          const records = parse(this.res.text, { columns: true, skipEmptyLines: true });
          expect(records.length).to.equal(1);
          expect(records[0].swotReproject).to.equal('1');
        });

      });

      describe('and requests the third page of 1 item', function () {
        hookGetRequestMetrics({ username: 'adam', query: { page: 3, limit: 1 } });
        it('returns the third item', function () {
          const records = parse(this.res.text, { columns: true, skipEmptyLines: true });
          expect(records.length).to.equal(1);
          expect(records[0].harmonyServiceExample).to.equal('1');
        });

      });

      describe('and requests the fourth page of 1 item', function () {
        hookGetRequestMetrics({ username: 'adam', query: { page: 4, limit: 1 } });
        it('returns no results because there are only 3 metrics', function () {
          const records = parse(this.res.text, { columns: true, skipEmptyLines: true });
          expect(records.length).to.equal(0);
        });

      });

      describe('and requests the first page of 2 items', function () {
        hookGetRequestMetrics({ username: 'adam', query: { page: 1, limit: 2 } });
        it('returns the first and second items', function () {
          const records = parse(this.res.text, { columns: true, skipEmptyLines: true });
          expect(records.length).to.equal(2);
          expect(records[0].trajectorySubsetter).to.equal('1');
          expect(records[1].swotReproject).to.equal('1');

          // Sanity checking that services not used are set to 0
          expect(records[0].harmonyServiceExample).to.equal('0');
        });
      });

      describe('and requests the second page of 2 items', function () {
        hookGetRequestMetrics({ username: 'adam', query: { page: 2, limit: 2 } });
        it('returns the third item', function () {
          const records = parse(this.res.text, { columns: true, skipEmptyLines: true });
          expect(records.length).to.equal(1);
          expect(records[0].harmonyServiceExample).to.equal('1');
        });
      });
    });
  });


  describe('when the user is not part of the admin group', function () {
    hookGetRequestMetrics({ username: 'tim' });
    it('returns a 403 Forbidden HTTP response', function () {
      expect(this.res.statusCode).to.equal(403);
    });
  });
});
