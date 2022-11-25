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
  { jobID: targetJob.jobID, workflowStepIndex: 2, serviceID: step2ServiceId, status: WorkItemStatus.RUNNING },
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
      await targetJob.save(this.trx);
      await item1.save(this.trx);
      await item2.save(this.trx);
      await item3.save(this.trx);
      await step1.save(this.trx);
      await step2.save(this.trx);

      await otherJob.save(this.trx);
      const otherItem1 = buildWorkItem({ jobID: otherJob.jobID, status: WorkItemStatus.CANCELED,
        runners: [{ id: 'runner1', startedAt: 0 }] });
      await otherItem1.save(this.trx);
      const otherItem2 = buildWorkItem({ jobID: otherJob.jobID, status: WorkItemStatus.FAILED,
        runners: [{ id: 'runner1', startedAt: 10 }] });
      await otherItem2.save(this.trx);
      const otherItem3 = buildWorkItem({ jobID: otherJob.jobID, status: WorkItemStatus.SUCCESSFUL,
        runners: [{ id: 'runner1', startedAt: 20 }, { id: 'runner2', startedAt: 50 }] });
      await otherItem3.save(this.trx);
      const otherItem4 = buildWorkItem({ jobID: otherJob.jobID, status: WorkItemStatus.READY,
        runners: [] });
      await otherItem4.save(this.trx);
      const otherStep1 = buildWorkflowStep({ jobID: otherJob.jobID, stepIndex: 1 });
      await otherStep1.save(this.trx);
      const otherStep2 = buildWorkflowStep({ jobID: otherJob.jobID, stepIndex: 2 });
      await otherStep2.save(this.trx);

      await shareableJob.save(this.trx);
      const shareableItem1 = buildWorkItem({ jobID: shareableJob.jobID, status: WorkItemStatus.RUNNING });
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

      describe('who requests the work items table for their job', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
        it('returns an HTML table of all the work items associated with the job', function () {
          const listing = this.res.text;
          [item1.workflowStepIndex, item2.workflowStepIndex, item3.workflowStepIndex]
            .forEach((stepIndex) => expect(listing).to.contain(mustache.render('<th scope="row">{{stepIndex}}</th>', { stepIndex })));
          [1, 2, 3]
            .forEach((id) => expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id })));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(3);
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
          expect((listing.match(/logs-button/g) || []).length).to.equal(0);
        });
        it('does not return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render(logsTableHeader, {}));
        });
        it('does not return a column for the pod logs', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain(mustache.render('>podLogs</th>', {}));
        });
        it('returns retry buttons for their RUNNING work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(1);
        });
        it('returns a column for the retry buttons', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<th scope="col">retry</th>', {}));
        });
      });

      describe('who requests the work items table for someone else\'s non-shareable job (but is an admin)', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: targetJob.jobID });
        it('returns links for the other user\'s work item logs', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-button/g) || []).length).to.equal(2);
        });
        it('does return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render(logsTableHeader, {}));
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

      describe('who requests the work items table for someone else\'s non-shareable job (a non-admin)', function () {
        hookWorkflowUIWorkItems({ username: 'not-bo', jobID: targetJob.jobID });
        it('returns a 403 HTTP response', async function () {
          expect(this.res.statusCode).to.equal(403);
        });
      });

      describe('who requests the work items table for someone else\'s shareable job (a non-admin)', function () {
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
        it('returns only one work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: 1 }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('returns a SUCCESSFUL work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(`<span class="badge bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
        });
      });

      describe('who requests page 2 of the work items table, with a limit of 1 and status IN [SUCCESSFUL]', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 1, page: 2, tableFilter: successfulFilter } });
        it('returns a link to the previous page', function () {
          const listing = this.res.text;
          ['limit=1', 'page=1', `tableFilter=${encodeURIComponent(successfulFilter)}`].forEach((param) => expect(listing).to.contain(
            mustache.render('{{param}}', { param })));
        });
        it('returns only one work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: 2 }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
        it('returns a SUCCESSFUL work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(`<span class="badge bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
        });
      });

      describe('who filters by status IN [RUNNING]', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { tableFilter: '[{"value":"status: running","dbValue":"running","field":"status"}]' } });
        it('returns only running work items', function () {
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

    describe('when accessing the admin endpoint', function () {
      describe('when the user is part of the admin group', function () {
        hookAdminWorkflowUIWorkItems({ username: 'adam', jobID: targetJob.jobID });
        it('returns the work items for any job, owned by any user', async function () {
          const listing = this.res.text;
          [item1.workflowStepIndex, item2.workflowStepIndex, item3.workflowStepIndex]
            .forEach((stepIndex) => expect(listing).to.contain(mustache.render('<th scope="row">{{stepIndex}}</th>', { stepIndex })));
          [step1ServiceIdScrubbed, step2ServiceIdScrubbed]
            .forEach((workflowItemStep) => expect(listing).to.contain(
              mustache.render('<td>{{workflowItemStep}}</td>', { workflowItemStep }),
            ));
          [1, 2, 3]
            .forEach((id) => expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id })));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(3);
        });
        it('returns links for the (completed) work item logs', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-button/g) || []).length).to.equal(2);
        });
        it('does return a column for the work item logs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render(logsTableHeader, {}));
        });
        it('does return a column for the pod logs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('>podLogs</th>', {}));
        });
        it('returns retry buttons for the RUNNING work items', async function () {
          const listing = this.res.text;
          expect((listing.match(/retry-button/g) || []).length).to.equal(1);
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
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(2);
          expect(listing).to.not.contain(`<span class="badge bg-danger">${WorkItemStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-success">${WorkItemStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-secondary">${WorkItemStatus.CANCELED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-primary">${WorkItemStatus.READY.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-info">${WorkItemStatus.RUNNING.valueOf()}</span>`);
        });
      });

      describe('when the admin filters by status IN [READY]', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: otherJob.jobID, 
          query: { tableFilter: '[{"value":"status: ready","dbValue":"ready","field":"status"}]' } });
        it('returns no pod logs links', function () {
          const listing = this.res.text;
          expect((listing.match(/pod-logs-link/g) || []).length).to.equal(0);
        });
      });

      describe('when the admin filters by status NOT IN [READY]', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: otherJob.jobID, 
          query: { disallowStatus: 'on', tableFilter: '[{"value":"status: ready","dbValue":"ready","field":"status"}]' } });
        it('returns pod logs links for each runner (pod) of each work item', function () {
          const listing = this.res.text;
          expect((listing.match(/pod-logs-link/g) || []).length).to.equal(4);
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
