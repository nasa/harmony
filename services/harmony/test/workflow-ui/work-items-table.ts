import * as mustache from 'mustache';
import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { v4 as uuid } from 'uuid';
import { buildWorkItem } from '../helpers/work-items';
import { buildWorkflowStep } from '../helpers/workflow-steps';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { hookWorkflowUIWorkItems, hookAdminWorkflowUIWorkItems, workflowUIWorkItems } from '../helpers/workflow-ui';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import { getWorkItemById } from '../../app/models/work-item';
import db from '../../app/util/db';
import MockDate from 'mockdate';
import { setLabelsForJob } from '../../app/models/label';

// main objects used in the tests
const targetJob = buildJob({ status: JobStatus.FAILED, username: 'bo' });
const woodysJob = buildJob({ status: JobStatus.PREVIEWING, username: 'woody' });

// build docker image urls / serviceIds
const ecrImage = 'dataservices/query-it:latest'; // non-sensitive part
const ecrLocation = '00000000.xyz.abc.region-5.amazonaws.com/'; // sensitive part
const earthdataImage = 'otherservices/subsetter:not-latest'; // non-sensitive part
const earthdataLocation = 'mightbeSensitive.earthdata.nasa.gov/'; // sensitive part
const step1ServiceId = `${ecrLocation}${ecrImage}`;
const step1ServiceIdScrubbed = ecrImage;
const step2ServiceId = `${earthdataLocation}${earthdataImage}`;
const step2ServiceIdScrubbed = earthdataImage;

// build the steps
const step1 = buildWorkflowStep(
  { jobID: targetJob.jobID, stepIndex: 1, serviceID: step1ServiceId },
);
const step2 = buildWorkflowStep(
  { jobID: targetJob.jobID, stepIndex: 2, serviceID: step2ServiceId },
);

// build the items
const item1 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 1, serviceID: step1ServiceId, status: WorkItemStatus.SUCCESSFUL },
);
const item2 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 1, serviceID: step1ServiceId, status: WorkItemStatus.SUCCESSFUL },
);
const item3 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 1, serviceID: step1ServiceId, status: WorkItemStatus.SUCCESSFUL },
);
const item4 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 2, serviceID: step2ServiceId, status: WorkItemStatus.RUNNING },
);
const item5 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 3, serviceID: step2ServiceId, status: WorkItemStatus.QUEUED },
);
const retryingWorkItem = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 2, serviceID: step2ServiceId, status: WorkItemStatus.RUNNING, retryCount: 1 },
);


// use to test functionality related to job sharing
const collectionWithEULAFalseAndGuestReadTrue = 'C1233800302-EEDTEST';
const shareableJob = buildJob({
  username: 'buzz',
  status: JobStatus.RUNNING_WITH_ERRORS,
  message: 'it is running',
  progress: 100,
  links: [{ href: 'http://example.com/woody1', rel: 'link', type: 'text/plain' }],
  request: 'http://example.com/harmony?request=buzz1&turbo=true',
  isAsync: true,
  numInputGranules: 2,
  collectionIds: [collectionWithEULAFalseAndGuestReadTrue],
});

// another job to make the scenario more realistic
const otherJob = buildJob({ status: JobStatus.CANCELED, username: 'not-bo' });
const otherItem3 = buildWorkItem({ jobID: otherJob.jobID, status: WorkItemStatus.RUNNING });

const logsTableHeader = '>logs</th>';

describe('Workflow UI work items table route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  before(async function () {
    await truncateAll();
  });

  after(async function () {
    await truncateAll();
  });

  describe('for a user who is not logged in', function () {
    before(async function () {
      this.res = await workflowUIWorkItems(
        this.frontend, { jobID: targetJob.jobID },
      ).redirects(0);
    });

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/workflow-ui/${targetJob.jobID}/work-items`));
    });
  });

  describe('for logged-in users', function () {
    hookTransaction();
    before(async function () {
      await woodysJob.save(this.trx);
      await targetJob.save(this.trx);
      MockDate.set('2021-01-04T14:12:05.000Z');
      await item1.save(this.trx);
      MockDate.set('2023-01-05T14:13:01.000Z');
      await item2.save(this.trx);
      MockDate.set('2023-01-06T14:12:00.000Z');
      await item3.save(this.trx);
      await item4.save(this.trx);
      await item5.save(this.trx);
      await retryingWorkItem.save(this.trx);
      await step1.save(this.trx);
      await step2.save(this.trx);

      await otherJob.save(this.trx);
      const otherItem1 = buildWorkItem({ jobID: otherJob.jobID, status: WorkItemStatus.CANCELED });
      await otherItem1.save(this.trx);
      const otherItem2 = buildWorkItem({ jobID: otherJob.jobID, status: WorkItemStatus.FAILED });
      await otherItem2.save(this.trx);
      await otherItem3.save(this.trx);
      const otherItem4 = buildWorkItem({ jobID: otherJob.jobID, status: WorkItemStatus.READY });
      await otherItem4.save(this.trx);
      const otherStep1 = buildWorkflowStep({ jobID: otherJob.jobID, stepIndex: 1 });
      await otherStep1.save(this.trx);
      const otherStep2 = buildWorkflowStep({ jobID: otherJob.jobID, stepIndex: 2 });
      await otherStep2.save(this.trx);

      await shareableJob.save(this.trx);
      const shareableItem1 = buildWorkItem({ jobID: shareableJob.jobID, status: WorkItemStatus.RUNNING });
      await shareableItem1.save(this.trx);
      const shareableItem2 = buildWorkItem({ jobID: shareableJob.jobID, workflowStepIndex: 2, serviceID: step2ServiceId, status: WorkItemStatus.SUCCESSFUL });
      await shareableItem2.save(this.trx);
      const shareableStep1 = buildWorkflowStep({ jobID: shareableJob.jobID, stepIndex: 1 });
      await shareableStep1.save(this.trx);
      const shareableStep2 = buildWorkflowStep({ jobID: shareableJob.jobID, stepIndex: 2 });
      await shareableStep2.save(this.trx);

      await setLabelsForJob(this.trx, targetJob.jobID, targetJob.username, ['my-label']);

      this.trx.commit();
      MockDate.reset();
    });

    describe('when accessing the non-admin endpoint', function () {
      describe('for a non-existent job ID', function () {
        const unknownRequest = uuid();
        hookWorkflowUIWorkItems({ jobID: unknownRequest, username: 'bo' });
        it('returns a 404 HTTP Not found response', function () {
          expect(this.res.statusCode).to.equal(404);
        });

        it('contains a "not found" error message', function () {
          expect(this.res.text).to.include('The requested resource could not be found');
        });
      });

      describe('for an invalid job ID format', function () {
        hookWorkflowUIWorkItems({ jobID: 'not-a-uuid', username: 'bo' });
        it('returns a 404 HTTP Not found response', function () {
          expect(this.res.statusCode).to.equal(400);
        });

        it('returns a JSON error response', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony.RequestValidationError',
            description: 'Error: Invalid format for Job ID \'not-a-uuid\'. Job ID must be a UUID.',
          });
        });
      });

      describe('who requests the work items table for their job (but is not a log viewer)', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns an HTML table of all the work items associated with the job', function () {
          const listing = this.res.text;
          [item1.workflowStepIndex, item2.workflowStepIndex, item3.workflowStepIndex, item4.workflowStepIndex,
            item5.workflowStepIndex, retryingWorkItem.workflowStepIndex]
            .forEach((stepIndex) => expect(listing).to.contain(mustache.render('<th scope="row">{{stepIndex}}</th>', { stepIndex })));
          [1, 2, 3, 4, 5, 6]
            .forEach((id) => expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id })));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(6);
        });
        it('return useful but nonsensitive information about docker images', function () {
          const listing = this.res.text;
          [step1.serviceID, step2.serviceID]
            .forEach((workflowItemStep) => expect(listing).to.not.contain(
              mustache.render('<td>{{workflowItemStep}}</td>', { workflowItemStep }),
            ));
          [step1ServiceIdScrubbed, step2ServiceIdScrubbed]
            .forEach((workflowItemStep) => expect(listing).to.contain(
              mustache.render('<td>{{workflowItemStep}}</td>', { workflowItemStep }),
            ));
        });
        it('does not return links for the work item logs', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-s3/g) || []).length).to.equal(0);
          expect((listing.match(/logs-metrics/g) || []).length).to.equal(0);
        });
        it('does not return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render(logsTableHeader, {}));
        });
        it('returns retry buttons for their RUNNING work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(2);
        });
        it('returns a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
        it('returns the job details (like labels and request URL)', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render(
            `{{#labels}}
          <span class="badge bg-label">{{.}}</span>
          {{/labels}}`,
            { labels: targetJob.labels }));
          expect(listing).to.contain('job-url-text');
          expect(listing).to.contain('copy-request');
        });
      });

      describe('who requests the work items table for someone else\'s non-shareable job (but is an admin)', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: targetJob.jobID });
        it('returns links for the other user\'s work item logs (stored in s3) for retrying and completed work items', async function () {
          const listing = this.res.text;
          const matches = listing.match(/logs-s3" href="([^"]+")/g);
          const urls = [];
          for (const logLine of matches) {
            const lineMatches = logLine.match(/logs-s3" href="([^"]+)"/);
            urls.push(lineMatches[1]);
          }
          expect((listing.match(/logs-s3/g) || []).length).to.equal(4);
          expect(urls[0]).to.equal(`/logs/${targetJob.jobID}/${item1.id}`);
        });

        it('returns metrics links for the other user\'s work item logs for every work item', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-metrics/g) || []).length).to.equal(6);
        });
        it('does return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render(logsTableHeader, {}));
        });
        it('returns retry buttons for the other user\'s RUNNING work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(2);
        });
        it('returns a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('who requests the work items table for someone else\'s non-shareable job (a non-admin)', function () {
        hookWorkflowUIWorkItems({ username: 'not-bo', jobID: targetJob.jobID });
        it('returns a 403 HTTP response', async function () {
          expect(this.res.statusCode).to.equal(403);
        });
      });

      describe('who requests the work items table for someone else\'s shareable job (not an admin or log-viewer)', function () {
        hookWorkflowUIWorkItems({ username: 'not-bo', jobID: shareableJob.jobID });
        it('returns a 200 HTTP response', async function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('does not return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render(logsTableHeader, {}));
        });
        it('does not return retry buttons for the other user\'s RUNNING work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(0);
        });
        it('does not return a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('who requests the work items table for someone else\'s shareable job (not an admin, but is a log-viewer)', function () {
        hookWorkflowUIWorkItems({ username: 'log-viewer-not-bo', jobID: shareableJob.jobID });
        it('returns a 200 HTTP response', async function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns links for the (completed) and currently running work item logs (stored in s3)', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-s3/g) || []).length).to.equal(1);
        });
        it('returns metrics logs links for all work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-metrics/g) || []).length).to.equal(2);
        });
        it('does return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render(logsTableHeader, {}));
        });
        it('does not return retry buttons for the other user\'s RUNNING work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(0);
        });
        it('does not return a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('who requests the work items table for someone else\'s shareable job (an admin)', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: shareableJob.jobID });
        it('returns a 200 HTTP response', async function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns retry buttons for the other user\'s RUNNING work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(1);
        });
        it('returns a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      const successfulFilter = '[{"value":"status: successful","dbValue":"successful","field":"status"}]';

      describe('who requests page 1 of the work items table, with a limit of 1 and status IN [SUCCESSFUL]', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 1, tableFilter: successfulFilter } });
        it('returns a link to the next page', function () {
          const listing = this.res.text;
          ['limit=1', 'page=2', `tableFilter=${encodeURIComponent(successfulFilter)}`].forEach((param) => expect(listing).to.contain(
            mustache.render('{{param}}', { param })));
        });
        it('returns a link to the last page', function () {
          const listing = this.res.text;
          ['limit=1', 'page=3', `tableFilter=${encodeURIComponent(successfulFilter)}`].forEach((param) => expect(listing).to.contain(
            mustache.render('{{param}}', { param })));
        });
        it('returns only one work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: 1 }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('returns a SUCCESSFUL work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(`<span class="badge rounded-pill bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
        });
      });

      const queuedFilter = '[{"value":"status: queued","dbValue":"queued","field":"status"}]';

      describe('who requests page 1 of the work items table, with a limit of 1 and status IN [QUEUED]', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 1, tableFilter: queuedFilter } });
        it('returns only one work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: 5 }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('returns a QUEUED work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(`<span class="badge rounded-pill bg-warning">${WorkItemStatus.QUEUED.valueOf()}</span>`);
        });
      });

      describe('who sets the limit to 0', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 0 } });
        it('the backend sets the page limit to 1', function () {
          const listing = this.res.text;
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
          expect(listing).to.contain('1-1 of 6 (page 1 of 6)');
        });
      });

      describe('who sets the limit to -1', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: -1 } });
        it('the backend sets the page limit to 1', function () {
          const listing = this.res.text;
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
          expect(listing).to.contain('1-1 of 6 (page 1 of 6)');
        });
      });

      describe('who has 0 work items in their job', function () {
        hookWorkflowUIWorkItems({ username: 'woody', jobID: woodysJob.jobID, query: { limit: 0 } });
        it('the paging descriptor makes sense', function () {
          const listing = this.res.text;
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(0);
          expect(listing).to.contain('0-0 of 0 (page 1 of 1)');
        });
      });

      describe('who requests page 2 of the work items table, with a limit of 1 and status IN [SUCCESSFUL]', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 1, page: 2, tableFilter: successfulFilter } });
        it('returns a link to the previous page', function () {
          const listing = this.res.text;
          ['limit=1', 'page=1', `tableFilter=${encodeURIComponent(successfulFilter)}`].forEach((param) => expect(listing).to.contain(
            mustache.render('{{param}}', { param })));
        });
        it('removes /work-items from the paging links', function () {
          const listing = this.res.text;
          expect(listing).to.not.contain('&#x2F;work-items');
        });
        it('returns only one work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: 2 }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('returns a SUCCESSFUL work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(`<span class="badge rounded-pill bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
        });
      });

      describe('who requests page 3 of the work items table, with a limit of 1 and status IN [SUCCESSFUL]', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 1, page: 3, tableFilter: successfulFilter } });
        it('returns a link to the previous page', function () {
          const listing = this.res.text;
          ['limit=1', 'page=2', `tableFilter=${encodeURIComponent(successfulFilter)}`].forEach((param) => expect(listing).to.contain(
            mustache.render('{{param}}', { param })));
        });
        it('returns a link to the first page', function () {
          const listing = this.res.text;
          ['limit=1', 'page=1', `tableFilter=${encodeURIComponent(successfulFilter)}`].forEach((param) => expect(listing).to.contain(
            mustache.render('{{param}}', { param })));
        });
        it('returns only one work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: 3 }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('returns a SUCCESSFUL work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(`<span class="badge rounded-pill bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
        });
      });

      describe('who requests page 2 of the work items table, with a limit of 2', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 2, page: 2 } });
        it('contains paging info', function () {
          const listing = this.res.text;
          expect(listing).to.contain('3-4 of 6 (page 2 of 3)');
        });
      });

      describe('who filters by status IN [RUNNING]', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { tableFilter: '[{"value":"status: running","dbValue":"running","field":"status"}]' } });
        it('returns only running work items', function () {
          const listing = this.res.text;
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(2);
          expect(listing).to.not.contain(`<span class="badge rounded-pill bg-danger">${WorkItemStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge rounded-pill bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge rounded-pill bg-secondary">${WorkItemStatus.CANCELED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge rounded-pill bg-primary">${WorkItemStatus.READY.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge rounded-pill bg-info">${WorkItemStatus.RUNNING.valueOf()}</span>`);
        });
      });
    });

    describe('who filters items by update date >=', function () {
      hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { tzoffsetminutes: '0', fromdatetime: '2023-01-06T14:12', datekind: 'updatedAt' } });
      it('returns the items with an acceptable updatedAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-06T14:12:00.000Z')).getTime());
        expect((listing.match(/work-item-table-row/g) || []).length).to.equal(4);
      });
    });

    describe('who filters items by update date >= with a timezone offset of -2 hour', function () {
      hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { tzoffsetminutes: '120', fromdatetime: '2023-01-06T12:12', datekind: 'updatedAt' } });
      it('returns the items with an acceptable updatedAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-06T14:12:00.000Z')).getTime());
        expect((listing.match(/work-item-table-row/g) || []).length).to.equal(4);
      });
    });

    describe('who filters items by update date >= with a timezone offset of +1 hour', function () {
      hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { tzoffsetminutes: '-60', fromdatetime: '2023-01-06T15:12', datekind: 'updatedAt' } });
      it('returns the items with an acceptable updatedAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-06T14:12:00.000Z')).getTime());
        expect((listing.match(/work-item-table-row/g) || []).length).to.equal(4);
      });
    });

    describe('who filters items by update date >= and <=', function () {
      hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID,
        query: { tzoffsetminutes: '0', fromdatetime: '2023-01-05T14:13', todatetime: '2023-01-05T14:14', datekind: 'updatedAt' } });
      it('returns the item with an acceptable updatedAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2023-01-05T14:13:01.000Z')).getTime());
        expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who filters items by update date <=', function () {
      hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID,
        query: { tzoffsetminutes: '0', todatetime: '2021-01-04T14:13', datekind: 'updatedAt' } });
      it('returns the item with acceptable updatedAt date', function () {
        const listing = this.res.text;
        expect(listing).to.contain((new Date('2021-01-04T14:12:05.000Z')).getTime());
        expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('when accessing the admin endpoint', function () {
      describe('when the user is part of the admin group', function () {
        hookAdminWorkflowUIWorkItems({ username: 'adam', jobID: targetJob.jobID });
        it('returns the work items for any job, owned by any user', async function () {
          const listing = this.res.text;
          [item1.workflowStepIndex, item2.workflowStepIndex, item3.workflowStepIndex, item4.workflowStepIndex,
            item5.workflowStepIndex, retryingWorkItem.workflowStepIndex]
            .forEach((stepIndex) => expect(listing).to.contain(mustache.render('<th scope="row">{{stepIndex}}</th>', { stepIndex })));
          [step1ServiceIdScrubbed, step2ServiceIdScrubbed]
            .forEach((workflowItemStep) => expect(listing).to.contain(
              mustache.render('<td>{{workflowItemStep}}</td>', { workflowItemStep }),
            ));
          [1, 2, 3, 4, 5, 6]
            .forEach((id) => expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id })));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(6);
        });
        it('returns links for the (completed) and currently running work item logs (stored in s3)', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-s3/g) || []).length).to.equal(4);
        });
        it('returns metrics logs links for all work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-metrics/g) || []).length).to.equal(6);
        });
        it('does return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render(logsTableHeader, {}));
        });
        it('returns retry buttons for the RUNNING work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(2);
        });
        it('returns a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('when the admin filters by status NOT IN [RUNNING]', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: targetJob.jobID,
          query: { disallowStatus: 'on', tableFilter: '[{"value":"status: running","dbValue":"running","field":"status"}]' } });
        it('returns only non-running work items', function () {
          const listing = this.res.text;
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(4);
          expect(listing).to.not.contain(`<span class="badge rounded-pill bg-danger">${WorkItemStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge rounded-pill bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge rounded-pill bg-warning">${WorkItemStatus.QUEUED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge rounded-pill bg-secondary">${WorkItemStatus.CANCELED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge rounded-pill bg-primary">${WorkItemStatus.READY.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge rounded-pill bg-info">${WorkItemStatus.RUNNING.valueOf()}</span>`);
        });
      });

      describe('when the admin retrieves otherJob\'s work items', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: otherJob.jobID });
        it('returns metrics logs links for each each work item', function () {
          const listing = this.res.text;
          expect((listing.match(/logs-metrics/g) || []).length).to.equal(4);
        });
      });

      describe('when the admin filters otherJob\'s items by status IN [RUNNING]', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: otherJob.jobID,
          query: { tableFilter: '[{"value":"status: running","dbValue":"running","field":"status"}]' } });
        it('sets the appropriate time range query parameter for the metrics url', async function () {
          const dateString = (await getWorkItemById(db, otherItem3.id)).createdAt.toISOString();
          expect(this.res.text).to.contain(`from:'${dateString}',to:'now'`);
        });
      });

      describe('when the user is not part of the admin group', function () {
        hookAdminWorkflowUIWorkItems({ username: 'eve', jobID: targetJob.jobID });
        it('returns an error', function () {
          expect(this.res.statusCode).to.equal(403);
          expect(this.res.text).to.include('You are not permitted to access this resource');
        });
      });
    });
  });
});
