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
import { hookWorkflowUIWorkItemsRow, workflowUIWorkItemsRow } from '../helpers/workflow-ui';
import { WorkItemStatus } from '../../app/models/work-item-interface';

// main objects used in the tests
const targetJob = buildJob({ status: JobStatus.FAILED, username: 'bo' });

// build docker image urls / serviceIds
const ecrImage = 'dataservices/query-it:latest'; // non-sensitive part
const ecrLocation = '00000000.xyz.abc.region-5.amazonaws.com/'; // sensitive part
const earthdataImage = 'otherservices/subsetter:not-latest'; // non-sensitive part
const earthdataLocation = 'mightbeSensitive.earthdata.nasa.gov/'; // sensitive part
const step1ServiceId = `${ecrLocation}${ecrImage}`;
const step1ServiceIdScrubbed = ecrImage;
const step2ServiceId = `${earthdataLocation}${earthdataImage}`;

// build the steps
const step1 = buildWorkflowStep(
  { jobID: targetJob.jobID, stepIndex: 1, serviceID: step1ServiceId },
);
const step2 = buildWorkflowStep(
  { jobID: targetJob.jobID, stepIndex: 2, serviceID: step2ServiceId },
);

// build the items
// give them an id so we know what id to request in the tests
const item1 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 1, serviceID: step1ServiceId, status: WorkItemStatus.RUNNING, id: 1 },
);
const item2 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 1, serviceID: step1ServiceId, status: WorkItemStatus.SUCCESSFUL, id: 2 },
);
const item3 = buildWorkItem(
  { jobID: targetJob.jobID, workflowStepIndex: 2, serviceID: step2ServiceId, status: WorkItemStatus.CANCELED },
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
const shareableItem1 = buildWorkItem({ jobID: shareableJob.jobID, status: WorkItemStatus.RUNNING, id: 10 });

describe('Workflow UI work items table row route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  before(async function () {
    await truncateAll();
  });

  after(async function () {
    await truncateAll();
  });

  describe('for a user who is not logged in', function () {
    before(async function () {
      this.res = await workflowUIWorkItemsRow(
        this.frontend, { jobID: targetJob.jobID, id: item1.id },
      ).redirects(0);
    });

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/workflow-ui/${targetJob.jobID}/work-items/${item1.id}`));
    });
  });

  describe('for logged-in users', function () {
    hookTransaction();
    before(async function () {
      await targetJob.save(this.trx);
      await item1.save(this.trx);
      await item2.save(this.trx);
      await item3.save(this.trx);
      await step1.save(this.trx);
      await step2.save(this.trx);

      // not really using these in the tests but saving them anyway
      // to make the scenario more realistic
      const otherJob = buildJob({ status: JobStatus.CANCELED, username: 'not-bo' });
      await otherJob.save(this.trx);
      const otherItem1 = buildWorkItem({ jobID: otherJob.jobID });
      await otherItem1.save(this.trx);
      const otherItem2 = buildWorkItem({ jobID: otherJob.jobID });
      await otherItem2.save(this.trx);
      const otherStep1 = buildWorkflowStep({ jobID: otherJob.jobID, stepIndex: 1 });
      await otherStep1.save(this.trx);
      const otherStep2 = buildWorkflowStep({ jobID: otherJob.jobID, stepIndex: 2 });
      await otherStep2.save(this.trx);

      await shareableJob.save(this.trx);
      await shareableItem1.save(this.trx);
      const shareableItem2 = buildWorkItem({ jobID: shareableJob.jobID });
      await shareableItem2.save(this.trx);
      const shareableStep1 = buildWorkflowStep({ jobID: shareableJob.jobID, stepIndex: 1 });
      await shareableStep1.save(this.trx);
      const shareableStep2 = buildWorkflowStep({ jobID: shareableJob.jobID, stepIndex: 2 });
      await shareableStep2.save(this.trx);

      this.trx.commit();
    });

    describe('when accessing the non-admin endpoint', function () {
      describe('for a non-existent job ID', function () {
        const unknownRequest = uuid();
        hookWorkflowUIWorkItemsRow({ jobID: unknownRequest, id: item1.id, username: 'bo' });
        it('returns a 404 HTTP Not found response', function () {
          expect(this.res.statusCode).to.equal(404);
        });

        it('contains a "not found" error message', function () {
          expect(this.res.text).to.include('The requested resource could not be found');
        });
      });

      describe('for an invalid job ID format', function () {
        hookWorkflowUIWorkItemsRow({ jobID: 'not-a-uuid', id: item1.id, username: 'bo' });
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

      describe('who requests a work item for their job', function () {
        hookWorkflowUIWorkItemsRow({ username: 'bo', jobID: targetJob.jobID, id: item1.id });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns an HTML row of the work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<th scope="row">{{stepIndex}}</th>', { stepIndex: item1.workflowStepIndex }));
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: item1.id }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('return useful but nonsensitive information about docker images', function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(
            mustache.render('<td>{{workflowItemStep}}</td>', { workflowItemStep: step1.serviceID }));
          expect(listing).to.contain(
            mustache.render('<td>{{workflowItemStep}}</td>', { workflowItemStep: step1ServiceIdScrubbed }));
        });
        it('does not return links for the work item logs', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-button/g) || []).length).to.equal(0);
        });
        it('does not return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('<th scope="col">logs</th>', {}));
        });
        it('returns a retry button for their RUNNING work item', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(1);
        });
        it('returns a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('who requests a SUCCESSFUL work item row for someone else\'s non-shareable job (but is an admin)', function () {
        hookWorkflowUIWorkItemsRow({ username: 'adam', jobID: targetJob.jobID, id: item2.id });
        it('returns a link for the other user\'s work item logs', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-button/g) || []).length).to.equal(1);
        });
      });

      describe('who requests a RUNNING work item row for someone else\'s non-shareable job (but is an admin)', function () {
        hookWorkflowUIWorkItemsRow({ username: 'adam', jobID: targetJob.jobID, id: item1.id });
        it('returns a retry button for the other user\'s RUNNING work item', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(1);
        });
        it('returns a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('who requests a work item row for someone else\'s non-shareable job (a non-admin)', function () {
        hookWorkflowUIWorkItemsRow({ username: 'not-bo', jobID: targetJob.jobID, id: item2.id });
        it('returns a 403 HTTP response', async function () {
          expect(this.res.statusCode).to.equal(403);
        });
      });

      describe('who requests a RUNNING work items table row for someone else\'s shareable job (a non-admin)', function () {
        hookWorkflowUIWorkItemsRow({ username: 'not-bo', jobID: shareableJob.jobID, id: shareableItem1.id });
        it('returns a 200 HTTP response', async function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns an HTML row of the work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<th scope="row">{{stepIndex}}</th>', { stepIndex: shareableItem1.workflowStepIndex }));
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: shareableItem1.id }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('does not return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('<th scope="col">logs</th>', {}));
        });
        it('does not return a retry button for the other user\'s RUNNING work item', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(0);
        });
        it('does not return a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('who requests a work items table row for someone else\'s shareable job (an admin)', function () {
        hookWorkflowUIWorkItemsRow({ username: 'adam', jobID: shareableJob.jobID, id: shareableItem1.id });
        it('returns a 200 HTTP response', async function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns an HTML row of the work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<th scope="row">{{stepIndex}}</th>', { stepIndex: shareableItem1.workflowStepIndex }));
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: shareableItem1.id }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('returns a retry button for the other user\'s RUNNING work item', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(1);
        });
        it('returns a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('who filters by status IN [RUNNING]', function () {
        hookWorkflowUIWorkItemsRow({ username: 'bo', jobID: targetJob.jobID, id: item1.id, query: { tableFilter: '[{"value":"status: running","dbValue":"running","field":"status"}]' } });
        it('returns the running work item', function () {
          const listing = this.res.text;
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
          expect(listing).to.not.contain(`<span class="badge bg-danger">${WorkItemStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-secondary">${WorkItemStatus.CANCELED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-primary">${WorkItemStatus.READY.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-info">${WorkItemStatus.RUNNING.valueOf()}</span>`);
        });
      });
    });
  });
});
