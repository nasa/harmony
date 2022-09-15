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

  describe('for a logged-in user', function () {
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

      this.trx.commit();
    });

    describe('when accessing the non-admin endpoint', function () {
      describe('for a non-existent job ID', function () {
        const unknownRequest = uuid();
        hookWorkflowUIWorkItems({ jobID: unknownRequest, username: 'bo' });
        it('returns a 404 HTTP Not found response', function () {
          expect(this.res.statusCode).to.equal(404);
        });

        it('returns a JSON error response', function () {
          expect(this.res.text).to.include(`Unable to find job ${unknownRequest}`);
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
      });

      describe('who requests the work items table for someone else\'s job (but is an admin)', function () {
        hookWorkflowUIWorkItems({ username: 'adam', jobID: targetJob.jobID });
        it('returns links for the other user\'s work item logs', async function () {
          const listing = this.res.text;
          expect((listing.match(/logs-button/g) || []).length).to.equal(2);
        });
      });

      describe('who requests page 1 of the work items table, with a limit of 1', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 1 } });
        it('returns a link to the next page', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{nextLink}}', { nextLink: `/workflow-ui/${targetJob.jobID}?limit=1&page=2` }));
        });
        it('returns only one work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: 1 }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
        });
      });

      describe('who requests page 2 of the work items table, with a limit of 1', function () {
        hookWorkflowUIWorkItems({ username: 'bo', jobID: targetJob.jobID, query: { limit: 1, page: 2 } });
        it('returns a link to the next and previous page', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('{{nextLink}}', { nextLink: `/workflow-ui/${targetJob.jobID}?limit=1&page=1` }));
          expect(listing).to.contain(mustache.render('{{prevLink}}', { prevLink: `/workflow-ui/${targetJob.jobID}?limit=1&page=3` }));
        });
        it('returns only one work item', function () {
          const listing = this.res.text;
          expect(listing).to.contain(mustache.render('<td>{{id}}</td>', { id: 2 }));
          expect((listing.match(/work-item-table-row/g) || []).length).to.equal(1);
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
