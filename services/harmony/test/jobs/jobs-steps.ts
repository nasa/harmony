import { expect } from 'chai';
import { before, describe, it } from 'mocha';
import request, { Test } from 'supertest';

import { JobStatus } from '../../app/models/job';
import WorkItem from '../../app/models/work-item';
import { getStacLocation, WorkItemStatus } from '../../app/models/work-item-interface';
import { serializedFields as workflowStepDbFields } from '../../app/models/workflow-steps';
import { objectStoreForProtocol } from '../../app/util/object-store';
import { auth } from '../helpers/auth';
import { hookTransaction } from '../helpers/db';
import { hookRequest } from '../helpers/hooks';
import { adminUsername, buildJob } from '../helpers/jobs';
import hookServersStartStop from '../helpers/servers';
import { buildWorkItem } from '../helpers/work-items';
import { buildWorkflowStep, validOperation } from '../helpers/workflow-steps';

/**
 * Issue a request to the steps endpoint. Mirrors the helpers/jobs.ts pattern
 * for jobStatus / adminJobStatus so it can be bound via hookRequest.
 */
function jobSteps(app, { jobID, query }: { jobID: string; query?: object }): Test {
  return request(app).get(`/jobs/${jobID}/steps`).query(query || {});
}

/**
 * Issue a request to the admin steps endpoint.
 */
function adminJobSteps(app, { jobID, query }: { jobID: string; query?: object }): Test {
  return request(app).get(`/admin/jobs/${jobID}/steps`).query(query || {});
}

const hookJobSteps = hookRequest.bind(this, jobSteps);
const hookAdminJobSteps = hookRequest.bind(this, adminJobSteps);

let wi2Id: number;

const joeJob = buildJob({
  username: 'joe',
  status: JobStatus.FAILED,
  message: 'Service failed',
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/foo?bar=baz',
});

const runningJob = buildJob({
  username: 'joe',
  status: JobStatus.RUNNING,
  request: 'https://harmony.example/running',
});

// Job exercising the batch-catalogs truncation path: a successful query-cmr WI
// whose batch-catalogs.json lists more catalog files than MAX_BATCH_CATALOGS.
const truncatedJob = buildJob({
  username: 'joe',
  status: JobStatus.SUCCESSFUL,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/truncated',
});

// Job written to a user-supplied destinationUrl bucket: its output catalog's
// data asset is an s3:// href that createPublicPermalink can't sign (not under
// /public/).
const destBucketJob = buildJob({
  username: 'joe',
  status: JobStatus.SUCCESSFUL,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/dest',
  destination_url: 's3://user-bucket/out',
});

// Job whose single step has more work items than DEFAULT_PER_PAGE (50), to
// exercise per-step paging and the paging links block.
const pagedJob = buildJob({
  username: 'joe',
  status: JobStatus.RUNNING,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/paged',
});

// Job whose single step holds one more work item than MAX_STEP_PAGE_SIZE, so a
// limit above the max defaults to MAX_STEP_PAGE_SIZE (1000)
const BIG_STEP_WORKITEMS = 1001;
const bigStepJob = buildJob({
  username: 'joe',
  status: JobStatus.RUNNING,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/big-step',
});

// Job with two steps each holding more than DEFAULT_PER_PAGE (50) work items, to
// exercise that each step pages independently via its own step<idx>Page param.
const twoPagedJob = buildJob({
  username: 'joe',
  status: JobStatus.RUNNING,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/two-paged',
});

describe('GET /jobs/:jobID/steps', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });
  hookTransaction();

  before(async function () {
    await joeJob.save(this.trx);
    // Step 1: query-cmr with a single successful work item
    const step1 = buildWorkflowStep({
      jobID: joeJob.jobID,
      stepIndex: 1,
      serviceID: '123456789012.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/query-cmr:latest',
      workItemCount: 1,
      operation: validOperation,
    });
    await step1.save(this.trx);
    const wi1 = buildWorkItem({
      jobID: joeJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'harmonyservices/query-cmr:latest',
      status: WorkItemStatus.SUCCESSFUL,
      scrollID: 'fake-scroll-key',
    });
    await wi1.save(this.trx);

    // Step 2: subsetter with a failed work item that has an input catalog from step 1
    const step2 = buildWorkflowStep({
      jobID: joeJob.jobID,
      stepIndex: 2,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      workItemCount: 1,
      operation: validOperation,
    });
    await step2.save(this.trx);
    const wi2 = buildWorkItem({
      jobID: joeJob.jobID,
      workflowStepIndex: 2,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      status: WorkItemStatus.FAILED,
      stacCatalogLocation: `s3://artifacts/${joeJob.jobID}/1/outputs/catalog.json`,
    });
    await wi2.save(this.trx);
    wi2Id = wi2.id;

    // A second job that's still running, with a single READY work item — used
    // to verify that incomplete WIs surface as files: null and that no S3
    // resolution is attempted on them.
    await runningJob.save(this.trx);
    const runningStep = buildWorkflowStep({
      jobID: runningJob.jobID,
      stepIndex: 1,
      serviceID: 'harmonyservices/query-cmr:latest',
      workItemCount: 1,
      operation: validOperation,
    });
    await runningStep.save(this.trx);
    const runningWi = buildWorkItem({
      jobID: runningJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'harmonyservices/query-cmr:latest',
      status: WorkItemStatus.READY,
    });
    await runningWi.save(this.trx);

    // A third job whose query-cmr WI has 105 catalog files listed in
    // batch-catalogs.json — 5 over MAX_BATCH_CATALOGS (5). (The catalog
    // files themselves are not staged.)
    await truncatedJob.save(this.trx);
    const truncatedStep = buildWorkflowStep({
      jobID: truncatedJob.jobID,
      stepIndex: 1,
      serviceID: 'harmonyservices/query-cmr:latest',
      workItemCount: 1,
      operation: validOperation,
    });
    await truncatedStep.save(this.trx);
    const truncatedWi = buildWorkItem({
      jobID: truncatedJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'harmonyservices/query-cmr:latest',
      status: WorkItemStatus.SUCCESSFUL,
      scrollID: 'fake-scroll-key',
    });
    await truncatedWi.save(this.trx);
    const overCapCatalogList = Array.from({ length: 100 }, (_, i) => `catalog${i}.json`);
    const batchUrl = getStacLocation(
      { id: truncatedWi.id, jobID: truncatedJob.jobID },
      'batch-catalogs.json',
    );
    await objectStoreForProtocol('s3').upload(
      JSON.stringify(overCapCatalogList), batchUrl, null, 'application/json',
    );

    // A job with a destinationUrl with a data asset is an s3:// href in
    // the user's destination bucket. Its single step has both a successful and
    // a failed work item, so it also exercises the per-status step summary.
    await destBucketJob.save(this.trx);
    const destStep = buildWorkflowStep({
      jobID: destBucketJob.jobID,
      stepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      workItemCount: 2,
      operation: validOperation,
    });
    await destStep.save(this.trx);
    const destWi = buildWorkItem({
      jobID: destBucketJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      status: WorkItemStatus.SUCCESSFUL,
    });
    await destWi.save(this.trx);
    const destFailedWi = buildWorkItem({
      jobID: destBucketJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      status: WorkItemStatus.FAILED,
    });
    await destFailedWi.save(this.trx);
    const s3 = objectStoreForProtocol('s3');
    const stacLoc = (f: string): string =>
      getStacLocation({ id: destWi.id, jobID: destBucketJob.jobID }, f);
    await s3.upload(JSON.stringify({
      stac_version: '1.0.0', id: 'cat', description: 'c',
      links: [{ rel: 'item', href: './item0.json' }],
    }), stacLoc('catalog.json'), null, 'application/json');
    await s3.upload(JSON.stringify({
      stac_version: '1.0.0', id: 'item0', type: 'Feature',
      geometry: null, properties: {}, links: [],
      assets: {
        'granule_reformatted.tif': {
          href: 's3://user-bucket/out/granule_reformatted.tif',
          type: 'image/tiff; application=geotiff; profile=cloud-optimized',
          roles: ['visual'],
        },
      },
    }), stacLoc('item0.json'), null, 'application/json');

    // A job whose single step holds 51 READY work items — one over
    // DEFAULT_PER_PAGE (50). READY items are skipped by catalog resolution, so
    // this stays cheap while still exercising the per-step bound + paging block.
    await pagedJob.save(this.trx);
    const pagedStep = buildWorkflowStep({
      jobID: pagedJob.jobID,
      stepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      workItemCount: 51,
      operation: validOperation,
    });
    await pagedStep.save(this.trx);
    const pagedWorkItems = Array.from({ length: 51 }, () => buildWorkItem({
      jobID: pagedJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      status: WorkItemStatus.READY,
    }));
    await WorkItem.insertBatch(this.trx, pagedWorkItems);

    // A job whose single step holds one more than MAX_STEP_PAGE_SIZE (1000) READY work
    // items, used to show a limit above the MAX_STEP_PAGE_SIZE defaults to MAX_STEP_PAGE_SIZE.
    await bigStepJob.save(this.trx);
    const bigStep = buildWorkflowStep({
      jobID: bigStepJob.jobID,
      stepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      workItemCount: BIG_STEP_WORKITEMS,
      operation: validOperation,
    });
    await bigStep.save(this.trx);
    const bigStepWorkItems = Array.from({ length: BIG_STEP_WORKITEMS }, () => buildWorkItem({
      jobID: bigStepJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      status: WorkItemStatus.READY,
    }));
    for (let i = 0; i < bigStepWorkItems.length; i += 500) {
      await WorkItem.insertBatch(this.trx, bigStepWorkItems.slice(i, i + 500));
    }

    // A job with two steps (1 and 2), each holding 51 READY work items, used to
    // verify the two steps page independently of each other.
    await twoPagedJob.save(this.trx);

    const step2a = buildWorkflowStep({
      jobID: twoPagedJob.jobID,
      stepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      workItemCount: 51,
      operation: validOperation,
    });
    await step2a.save(this.trx);
    await WorkItem.insertBatch(this.trx, Array.from({ length: 51 }, () => buildWorkItem({
      jobID: twoPagedJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'nasa/harmony-opendap-subsetter:1.2.4',
      status: WorkItemStatus.READY,
    })));
    const step2b = buildWorkflowStep({
      jobID: twoPagedJob.jobID,
      stepIndex: 2,
      serviceID: 'sds/harmony-metadata-annotator:latest',
      workItemCount: 51,
      operation: validOperation,
    });
    await step2b.save(this.trx);
    await WorkItem.insertBatch(this.trx, Array.from({ length: 51 }, () => buildWorkItem({
      jobID: twoPagedJob.jobID,
      workflowStepIndex: 2,
      serviceID: 'sds/harmony-metadata-annotator:latest',
      status: WorkItemStatus.READY,
    })));


    await this.trx.commit();
  });

  describe('For a user who is not logged in', function () {
    hookJobSteps({ jobID: joeJob.jobID });
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
    });
  });

  describe('For a non-owner who is not admin', function () {
    hookJobSteps({ jobID: joeJob.jobID, username: 'stranger' });
    it('denies access', function () {
      expect(this.res.statusCode).to.equal(403);
    });
  });

  describe('For the owner requesting the default steps response', function () {
    hookJobSteps({ jobID: joeJob.jobID, username: 'joe' });

    it('returns 200 with a steps document for the job', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.jobID).to.equal(joeJob.jobID);
      expect(body.status).to.equal('failed');
      expect(body.username).to.equal('joe');
      expect(body.serviceName).to.equal('harmony-best-service');
      expect(body.request).to.equal('https://harmony.example/foo?bar=baz');
    });

    it('includes both workflow steps with expected keys', function () {
      const body = JSON.parse(this.res.text);
      expect(body.steps).to.have.lengthOf(2);
      expect(body.steps[0].stepIndex).to.equal(1);
      expect(body.steps[0].serviceID).to.equal('harmonyservices/query-cmr:latest');
      expect(body.steps[0].workItemCount).to.equal(1);
      expect(body.steps[1].stepIndex).to.equal(2);
      expect(body.steps[1].serviceID).to.equal('nasa/harmony-opendap-subsetter:1.2.4');
      expect(body.steps[1].workItemCount).to.equal(1);
      expect(body.steps[1].workItems).to.have.length(1);
    });

    it('exposes correct step-level state on the response', function () {
      const expectedKeys = ['serviceID', 'stepIndex', 'workItemCount', 'statuses', 'workItems'];
      const unexposedKeys = workflowStepDbFields.filter((f) => !expectedKeys.includes(f));
      const body = JSON.parse(this.res.text);
      for (const step of body.steps) {
        expect(step).to.not.have.any.keys(...unexposedKeys);
        expect(step).to.have.keys(expectedKeys);
      }
    });

    it('summarizes each step with per-status work item counts', function () {
      const body = JSON.parse(this.res.text);
      // Step 1: one successful query-cmr WI. Step 2: one failed subsetter WI.
      // Only non-zero statuses appear, and the keys are WorkItemStatus values
      // ('failed', not 'failure').
      expect(body.steps[0].statuses).to.deep.equal({ successful: 1 });
      expect(body.steps[1].statuses).to.deep.equal({ failed: 1 });
    });

    it('exposes inputFiles / outputFiles fields', function () {
      const body = JSON.parse(this.res.text);
      const wi1 = body.steps[0].workItems[0];
      const wi2 = body.steps[1].workItems[0];
      expect(wi1).to.have.property('inputFiles');
      expect(wi1).to.have.property('outputFiles');
      expect(wi1.inputFiles).to.be.null;
      expect(wi1.outputFiles).to.be.an('array');
      expect(wi2).to.have.property('inputFiles');
      expect(wi2.inputFiles).to.be.an('array');
      expect(wi2).to.have.property('outputFiles');
    });

  });

  describe('Filtering with ?step=', function () {
    hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { step: 2 } });
    it('returns only the requested step', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.steps).to.have.lengthOf(1);
      expect(body.steps[0].stepIndex).to.equal(2);
    });
  });

  describe('Filtering with ?status=failed', function () {
    hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { status: 'failed' } });
    it('keeps only work items in that status', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      for (const step of body.steps) {
        for (const wi of step.workItems) {
          expect(wi.status).to.equal('failed');
        }
      }
      const stepsWithItems = body.steps.filter((s) => s.workItems.length > 0);
      expect(stepsWithItems).to.have.lengthOf(1);
      expect(stepsWithItems[0].stepIndex).to.equal(2);
    });
  });

  describe('Top-level pagination has been removed', function () {
    hookJobSteps({ jobID: joeJob.jobID, username: 'joe' });
    it('does not include a top-level pagination object', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body).to.not.have.property('pagination');
    });
    it('does not add a paging block to steps under the per-step limit', function () {
      const body = JSON.parse(this.res.text);
      for (const step of body.steps) {
        expect(step).to.not.have.property('paging');
      }
    });
  });

  describe('For a job whose work item is still incomplete', function () {
    hookJobSteps({ jobID: runningJob.jobID, username: 'joe' });
    it('leaves outputFiles as null and does not attempt resolution', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      expect(wi.status).to.equal('ready');
      expect(wi.outputFiles).to.equal(null);
      expect(wi.inputFiles).to.equal(null);
    });
  });

  describe('For an admin user fetching another user\'s job via /admin/jobs/:jobID/steps', function () {
    hookAdminJobSteps({ jobID: joeJob.jobID, username: adminUsername });
    it('returns 200 with the job\'s steps', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.jobID).to.equal(joeJob.jobID);
      expect(body.steps).to.have.lengthOf(2);
    });
  });

  describe('For a jobID that does not exist', function () {
    hookJobSteps({
      jobID: '00000000-0000-4000-8000-000000000000',
      username: 'joe',
    });
    it('returns 404', function () {
      expect(this.res.statusCode).to.equal(404);
    });
  });

  describe('Filtering with ?step= for an unknown step index', function () {
    hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { step: 99 } });
    it('returns 200 with an empty steps array', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.steps).to.deep.equal([]);
    });
  });

  describe('Filtering with ?workItem=<id>', function () {
    // Custom before because hookJobSteps captures `query` at describe-load
    // time, but wi2Id is only set by the outer `before` (after save).
    before(async function () {
      this.res = await jobSteps(
        this.frontend,
        { jobID: joeJob.jobID, query: { workItem: wi2Id } },
      ).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('returns only the requested work item, in its parent step', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      // The workItem filter + drop-empty-when-filtering means only step 2
      // surfaces, with exactly the targeted work item.
      expect(body.steps).to.have.lengthOf(1);
      expect(body.steps[0].stepIndex).to.equal(2);
      expect(body.steps[0].workItems).to.have.lengthOf(1);
      expect(body.steps[0].workItems[0].id).to.equal(wi2Id);
    });
  });

  describe('When batch-catalogs.json exceeds MAX_BATCH_CATALOGS', function () {
    hookJobSteps({ jobID: truncatedJob.jobID, username: 'joe' });

    it('includes a truncation warning when outputFiles in incomplete', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const { outputFiles, warning } = body.steps[0].workItems[0];
      expect(outputFiles).to.be.an('array');
      expect(warning).to.equal('Not all output files are included. Only the outputs from the first ' +
        '5 STAC catalogs were resolved, there are 95 catalogs that were not resolved.');
    });
  });

  describe('For a job written to a user destinationUrl bucket', function () {
    hookJobSteps({ jobID: destBucketJob.jobID, username: 'joe' });

    it('displays a generic asset and passes the destination-bucket href through', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const { outputFiles, warning } = body.steps[0].workItems[0];
      expect(outputFiles).to.deep.equal(['s3://user-bucket/out/granule_reformatted.tif']);
      expect(warning).not.to.exist;
    });

    it('summarizes both statuses present in the step', function () {
      const body = JSON.parse(this.res.text);
      expect(body.steps[0].statuses).to.deep.equal({ successful: 1, failed: 1 });
    });
  });

  describe('For a mixed-status step filtered with ?status=failed', function () {
    hookJobSteps({ jobID: destBucketJob.jobID, username: 'joe', query: { status: 'failed' } });

    it('reports the whole-step summary when work items are filtered', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step = body.steps[0];
      expect(step.workItems).to.have.lengthOf(1);
      expect(step.workItems[0].status).to.equal('failed');
      expect(step.statuses).to.deep.equal({ successful: 1, failed: 1 });
    });
  });

  describe('For a step with more work items than the per-step limit', function () {
    hookJobSteps({ jobID: pagedJob.jobID, username: 'joe' });

    it('caps the work items at DEFAULT_PER_PAGE and adds a paging block with links', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step = body.steps[0];
      // 51 work items exist, but the page is bounded to the default per-page limit.
      expect(step.workItems).to.have.lengthOf(50);
      expect(step.paging.currentPage).to.equal(1);
      expect(step.paging.lastPage).to.equal(2);
      expect(step.paging.total).to.equal(51);
      const next = step.paging.links.find((l) => l.rel === 'next');
      expect(next.href).to.include('step1page=2');
      // First page has no prev link.
      expect(step.paging.links.find((l) => l.rel === 'prev')).to.be.undefined;
      // The status summary for whole step.
      expect(step.statuses).to.deep.equal({ ready: 51 });
    });
  });

  describe('Requesting the last page of a step with ?step<idx>Page=', function () {
    hookJobSteps({ jobID: pagedJob.jobID, username: 'joe', query: { step1Page: 2 } });

    it('returns the remaining work items with prev/first links and no next', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step = body.steps[0];
      expect(step.workItems).to.have.lengthOf(1);
      expect(step.paging.currentPage).to.equal(2);
      expect(step.paging.links.find((l) => l.rel === 'prev').href).to.include('step1page=1');
      expect(step.paging.links.find((l) => l.rel === 'next')).to.be.undefined;
    });
  });

  describe('Setting the shared page size with ?limit=', function () {
    hookJobSteps({ jobID: pagedJob.jobID, username: 'joe', query: { limit: 25 } });

    it('uses the limit as the per-step page size', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step = body.steps[0];
      expect(step.workItems).to.have.lengthOf(25);
      expect(step.paging.lastPage).to.equal(3); // ceil(51 / 25)
    });
  });

  describe('When ?limit= exceeds the maximum page size', function () {
    hookJobSteps({ jobID: bigStepJob.jobID, username: 'joe', query: { limit: 99999 } });

    it('defaults limit to MAX_STEP_PAGE_SIZE and pages', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step = body.steps[0];
      expect(step.workItems).to.have.lengthOf(1000);
      expect(step.paging.currentPage).to.equal(1);
      expect(step.paging.lastPage).to.equal(2);
      expect(step.paging.total).to.equal(1001);
      expect(step.paging.links.find((l) => l.rel === 'next').href).to.include('step1page=2');
    });
  });

  describe('Requesting a page past the last page without filtering', function () {
    hookJobSteps({ jobID: pagedJob.jobID, username: 'joe', query: { step1Page: 4 } });

    it('still emits a paging block with a way back even with no items on the page', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step = body.steps[0];
      expect(step.workItems).to.have.lengthOf(0);
      expect(step.paging.currentPage).to.equal(4);
      expect(step.paging.lastPage).to.equal(2);
      expect(step.paging.total).to.equal(51);
      expect(step.paging.links.find((l) => l.rel === 'first').href).to.include('step1page=1');
      expect(step.paging.links.find((l) => l.rel === 'next')).to.be.undefined;
    });
  });

  describe('When a status filter and page query go beyond last page', function () {
    hookJobSteps({
      jobID: destBucketJob.jobID, username: 'joe', query: { status: 'successful', step1Page: 4 },
    });

    it('keeps the step and emits an paging block with first page', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.steps).to.have.lengthOf(1);
      const step = body.steps[0];
      expect(step.workItems).to.have.lengthOf(0);
      expect(step.paging.currentPage).to.equal(4);
      expect(step.paging.lastPage).to.equal(1);
      expect(step.paging.total).to.equal(1);
      expect(step.paging.links.find((l) => l.rel === 'first').href).to.include('step1page=1');
    });
  });

  describe('For a job with two independently pageable steps', function () {
    hookJobSteps({ jobID: twoPagedJob.jobID, username: 'joe', query: { step1Page: 2 } });

    it('pages the requested step without affecting the other', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step1 = body.steps.find((s) => s.stepIndex === 1);
      const step2 = body.steps.find((s) => s.stepIndex === 2);
      // Step 1 advanced to page 2 (1 item), step 2 stayed on page 1 (50 items).
      expect(step1.workItems).to.have.lengthOf(1);
      expect(step1.paging.currentPage).to.equal(2);
      expect(step2.workItems).to.have.lengthOf(50);
      expect(step2.paging.currentPage).to.equal(1);
      // Step 2's next link preserves step 1's page
      expect(step2.paging.links.find((l) => l.rel === 'next').href).to.include('step1page=2');
      expect(step2.paging.links.find((l) => l.rel === 'next').href).to.include('step2page=2');
      expect(step1.paging.links.find((l) => l.rel === 'prev').href).to.include('step1page=1');
    });
  });

  describe('Query parameter names are case-insensitive', function () {
    hookJobSteps({ jobID: pagedJob.jobID, username: 'joe', query: { LIMIT: 25, STEP1PAGE: 2 } });

    it('parses upper-cased parameter names the same as lower-cased ones', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step = body.steps[0];
      // ?LIMIT=25&STEP1PAGE=2 -> page 2 of 25-item pages over 51 items (26 left).
      expect(step.workItems).to.have.lengthOf(25);
      expect(step.paging.currentPage).to.equal(2);
      expect(step.paging.lastPage).to.equal(3);
      expect(step.paging.links.find((l) => l.rel === 'prev').href).to.include('step1page=1');
    });
  });

  describe('Validation errors', function () {
    describe('?status=bogus', function () {
      hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { status: 'bogus' } });
      it('returns 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });
    });

  });
});
