import { expect } from 'chai';
import { before, describe, it } from 'mocha';
import request, { Test } from 'supertest';

import { hookTransaction } from '../../../../packages/util/test/helpers/db';
import { JobStatus } from '../../app/models/job';
import WorkItem from '../../app/models/work-item';
import { getStacLocation, WorkItemStatus } from '../../app/models/work-item-interface';
import { serializedFields as workflowStepDbFields } from '../../app/models/workflow-steps';
import { objectStoreForProtocol } from '../../app/util/object-store';
import { auth } from '../helpers/auth';
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

let wi1Id: number;
let wi2Id: number;
let pagedOutputWiId: number;
let inputPagedWiId: number;
let destWiId: number;

// Number of output catalogs staged for the paged-output work item, chosen to
// span more than one page given the 50-catalog page size (ceil(60/50) = 2).
const PAGED_OUTPUT_CATALOGS = 60;

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

// Job exercising per-work-item output-file paging: a successful query-cmr WI
// whose batch-catalogs.json lists more catalog files than one output page.
const pagedOutputJob = buildJob({
  username: 'joe',
  status: JobStatus.SUCCESSFUL,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/paged-output',
});

// Job whose single work item has an input catalog referencing more items than one
// input page, to exercise per-work-item input-file paging in resolve mode.
const inputPagedJob = buildJob({
  username: 'joe',
  status: JobStatus.SUCCESSFUL,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/input-paged',
});
// Number of items the input catalog references, chosen to span more than one page
// given the 50-item page size (ceil(60/50) = 2).
const INPUT_CATALOG_ITEMS = 60;

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

// Job whose single step has more work items than DEFAULT_WORKITEMS_PER_PAGE (50), to
// exercise per-step paging and the paging links block.
const pagedJob = buildJob({
  username: 'joe',
  status: JobStatus.RUNNING,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/paged',
});

// Job whose single step holds one more work item than MAX_WORKITEMS_PER_PAGE, so a
// limit above the max defaults to MAX_WORKITEMS_PER_PAGE (1000)
const BIG_STEP_WORKITEMS = 1001;
const bigStepJob = buildJob({
  username: 'joe',
  status: JobStatus.RUNNING,
  service_name: 'harmony-best-service',
  request: 'https://harmony.example/big-step',
});

// Job with two steps each holding more than DEFAULT_WORKITEMS_PER_PAGE (50) work items, to
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
    wi1Id = wi1.id;

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

    // A third job whose query-cmr WI fans out to PAGED_OUTPUT_CATALOGS catalog
    // files, each referencing one item with one data asset. Both the
    // batch-catalogs.json index and every catalog/item file are staged so
    // output-file paging resolves real hrefs across multiple pages.
    await pagedOutputJob.save(this.trx);
    const pagedOutputStep = buildWorkflowStep({
      jobID: pagedOutputJob.jobID,
      stepIndex: 1,
      serviceID: 'harmonyservices/query-cmr:latest',
      workItemCount: 1,
      operation: validOperation,
    });
    await pagedOutputStep.save(this.trx);
    const pagedOutputWi = buildWorkItem({
      jobID: pagedOutputJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'harmonyservices/query-cmr:latest',
      status: WorkItemStatus.SUCCESSFUL,
      scrollID: 'fake-scroll-key',
    });
    await pagedOutputWi.save(this.trx);
    pagedOutputWiId = pagedOutputWi.id;
    const pagedStore = objectStoreForProtocol('s3');
    const pagedLoc = (f: string): string =>
      getStacLocation({ id: pagedOutputWi.id, jobID: pagedOutputJob.jobID }, f);
    const catalogList = Array.from({ length: PAGED_OUTPUT_CATALOGS }, (_, i) => `catalog${i}.json`);
    await pagedStore.upload(
      JSON.stringify(catalogList), pagedLoc('batch-catalogs.json'), null, 'application/json',
    );
    await Promise.all(Array.from({ length: PAGED_OUTPUT_CATALOGS }, (_, i) => Promise.all([
      // create individual stac catalogs listed in the batch-catalogs pointing
      // at the item[n].json files
      pagedStore.upload(JSON.stringify({
        stac_version: '1.0.0', id: `cat${i}`, description: 'c',
        links: [{ rel: 'item', href: `./item${i}.json` }],
      }), pagedLoc(`catalog${i}.json`), null, 'application/json'),
      // create the item[n].json catalogs with the file's href in it.
      pagedStore.upload(JSON.stringify({
        stac_version: '1.0.0', id: `item${i}`, type: 'Feature',
        geometry: null, properties: {}, links: [],
        assets: { data: { href: `https://example.com/granule${i}.nc4`, roles: ['data'] } },
      }), pagedLoc(`item${i}.json`), null, 'application/json'),
    ])));

    // A job whose work item's input catalog references INPUT_CATALOG_ITEMS items,
    // spanning more than one input page. The catalog and every item file are staged
    // so input-file paging (resolve mode) resolves real hrefs across pages.
    await inputPagedJob.save(this.trx);
    const inputPagedStep = buildWorkflowStep({
      jobID: inputPagedJob.jobID,
      stepIndex: 1,
      serviceID: 'nasa/batch-aggregator-service:2.4.1',
      workItemCount: 1,
      operation: validOperation,
    });
    await inputPagedStep.save(this.trx);
    const inputLoc = (f: string): string => `s3://artifacts/${inputPagedJob.jobID}/input/${f}`;
    const inputCatalogUrl = inputLoc('catalog.json');
    const inputPagedWi = buildWorkItem({
      jobID: inputPagedJob.jobID,
      workflowStepIndex: 1,
      serviceID: 'nasa/batch-aggregator-service:2.4.1',
      status: WorkItemStatus.SUCCESSFUL,
      stacCatalogLocation: inputCatalogUrl,
    });
    await inputPagedWi.save(this.trx);
    inputPagedWiId = inputPagedWi.id;
    const inputStore = objectStoreForProtocol('s3');
    await inputStore.upload(JSON.stringify({
      stac_version: '1.0.0', id: 'input-cat', description: 'c',
      links: Array.from({ length: INPUT_CATALOG_ITEMS }, (_, i) => ({ rel: 'item', href: `./item${i}.json` })),
    }), inputCatalogUrl, null, 'application/json');
    await Promise.all(Array.from({ length: INPUT_CATALOG_ITEMS }, (_, i) =>
      inputStore.upload(JSON.stringify({
        stac_version: '1.0.0', id: `input-item${i}`, type: 'Feature',
        geometry: null, properties: {}, links: [],
        assets: { data: { href: `https://example.com/input${i}.nc4`, roles: ['data'] } },
      }), inputLoc(`item${i}.json`), null, 'application/json')));

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
    destWiId = destWi.id;
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
    // DEFAULT_WORKITEMS_PER_PAGE (50). READY items are skipped by catalog resolution, so
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

    // A job whose single step holds one more than MAX_WORKITEMS_PER_PAGE (1000) READY work
    // items, used to show a limit above the MAX_WORKITEMS_PER_PAGE defaults to MAX_WORKITEMS_PER_PAGE.
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

    it('exposes link-only inputFilesUrl / outputFilesUrl fields and no inline files', function () {
      const body = JSON.parse(this.res.text);
      const wi1 = body.steps[0].workItems[0];
      const wi2 = body.steps[1].workItems[0];

      expect(wi1).to.not.have.property('inputFiles');
      expect(wi1).to.not.have.property('outputFiles');

      expect(wi1.inputFilesUrl).to.be.null;
      expect(wi1.outputFilesUrl).to.include(`workitem=${wi1Id}`);
      expect(wi1.outputFilesUrl).to.include('resolvefiles=output');

      expect(wi2.inputFilesUrl).to.include(`workitem=${wi2Id}`);
      expect(wi2.inputFilesUrl).to.include('resolvefiles=input');
      expect(wi2.outputFilesUrl).to.include(`workitem=${wi2Id}`);
      expect(wi2.outputFilesUrl).to.include('resolvefiles=output');
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

  describe('Filtering with ?step=1,2 multiple step params', function () {
    hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { step: '1,2' } });
    it('returns each requested step', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.steps.map((s) => s.stepIndex)).to.deep.equal([1, 2]);
    });
  });

  describe('?step=1&step=2 (repeated param) matches ?step=1,2', function () {
    before(async function () {
      this.repeated = await jobSteps(this.frontend,
        { jobID: joeJob.jobID, query: { step: [1, 2] } }).use(auth({ username: 'joe' }));
      this.comma = await jobSteps(this.frontend,
        { jobID: joeJob.jobID, query: { step: '1,2' } }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.repeated; delete this.comma; });

    it('produces the same steps', function () {
      expect(this.repeated.statusCode).to.equal(200);
      expect(this.repeated.text).to.equal(this.comma.text);
    });
  });

  describe('Filtering with ?status=failed,successful multiple status params', function () {
    hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { status: 'failed,successful' } });
    it('keeps work items in any of the requested statuses', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.steps).to.have.lengthOf(2);
      for (const step of body.steps) {
        for (const wi of step.workItems) {
          expect(wi.status).to.be.oneOf(['failed', 'successful']);
        }
      }
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
    it('leaves both input and ouput file links as null', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      expect(wi.status).to.equal('ready');

      expect(wi.outputFilesUrl).to.equal(null);
      expect(wi.inputFilesUrl).to.equal(null);
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

  describe('Filtering with ?workItem=<id1>,<id2> multiple workitem params', function () {
    before(async function () {
      this.res = await jobSteps(
        this.frontend,
        { jobID: joeJob.jobID, query: { workItem: `${wi1Id},${wi2Id}` } },
      ).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('returns each requested work item in its parent step', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.steps).to.have.lengthOf(2);
      const ids = body.steps.flatMap((s) => s.workItems.map((wi) => wi.id));
      expect(ids).to.have.members([wi1Id, wi2Id]);
    });
  });

  describe('Resolving a work item with more than one page of output catalogs', function () {
    before(async function () {
      this.res = await jobSteps(this.frontend, {
        jobID: pagedOutputJob.jobID, query: { workItem: pagedOutputWiId, resolveFiles: 'output' },
      }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('returns only the first page of output files and an outputFilesPaging block', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      // 60 catalogs over a 50-catalog page: page 1 resolves exactly 50 files
      expect(wi.outputFiles).to.have.lengthOf(50);
      expect(wi.outputFiles[0]).to.equal('https://example.com/granule0.nc4');
      expect(wi.outputFiles[49]).to.equal('https://example.com/granule49.nc4');
      expect(wi.outputFilesPaging.currentPage).to.equal(1);
      expect(wi.outputFilesPaging.lastPage).to.equal(2); // ceil(60 / 50)
      expect(wi.outputFilesPaging.total).to.equal(60);
      const next = wi.outputFilesPaging.links.find((l) => l.rel === 'next');
      expect(next.href).to.include(`workitem${pagedOutputWiId}outputpage=2`);
      expect(wi.outputFilesPaging.links.find((l) => l.rel === 'prev')).to.be.undefined;
    });
  });

  describe('When ?wiLimit= overrides the output-catalog page size', function () {
    before(async function () {
      this.res = await jobSteps(this.frontend, {
        jobID: pagedOutputJob.jobID, query: { workItem: pagedOutputWiId, resolveFiles: 'output', wiLimit: 5 },
      }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('pages the output files using the requested size', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      // 60 catalogs over a 5-catalog page: page 1 resolves exactly 5 files.
      expect(wi.outputFiles).to.have.lengthOf(5);
      expect(wi.outputFiles[0]).to.equal('https://example.com/granule0.nc4');
      expect(wi.outputFiles[4]).to.equal('https://example.com/granule4.nc4');
      expect(wi.outputFilesPaging.currentPage).to.equal(1);
      expect(wi.outputFilesPaging.lastPage).to.equal(12); // ceil(60 / 5)
      expect(wi.outputFilesPaging.total).to.equal(60);
    });

  });

  describe('Requesting the last page of a work item\'s output files', function () {
    before(async function () {
      this.res = await jobSteps(this.frontend, {
        jobID: pagedOutputJob.jobID,
        query: { workItem: pagedOutputWiId, resolveFiles: 'output', [`workItem${pagedOutputWiId}OutputPage`]: 2 },
      }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('returns the remaining output files with prev/first links and no next', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      expect(wi.outputFiles).to.have.lengthOf(10); // catalogs 50..59
      expect(wi.outputFiles[0]).to.equal('https://example.com/granule50.nc4');
      expect(wi.outputFilesPaging.currentPage).to.equal(2);
      expect(wi.outputFilesPaging.links.find((l) => l.rel === 'prev').href)
        .to.include(`workitem${pagedOutputWiId}outputpage=1`);
      expect(wi.outputFilesPaging.links.find((l) => l.rel === 'next')).to.be.undefined;
    });
  });

  describe('Requesting an output-file page past the last page', function () {
    before(async function () {
      this.res = await jobSteps(this.frontend, {
        jobID: pagedOutputJob.jobID,
        query: { workItem: pagedOutputWiId, resolveFiles: 'output', [`workItem${pagedOutputWiId}OutputPage`]: 9 },
      }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('returns the last page instead of an empty page', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      expect(wi.outputFiles).to.have.lengthOf(10);
      expect(wi.outputFilesPaging.currentPage).to.equal(2);
      expect(wi.outputFilesPaging.lastPage).to.equal(2);
    });
  });

  describe('Resolving a work item with more than one page of input items', function () {
    before(async function () {
      this.res = await jobSteps(this.frontend, {
        jobID: inputPagedJob.jobID, query: { workItem: inputPagedWiId, resolveFiles: 'input' },
      }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('returns only the first page of input files and an inputFilesPaging block', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      // 60 items over a 50-item page: page 1 reads exactly 50 items
      expect(wi.inputFiles).to.have.lengthOf(50);
      expect(wi.inputFiles[0]).to.equal('https://example.com/input0.nc4');
      expect(wi.inputFiles[49]).to.equal('https://example.com/input49.nc4');
      expect(wi.inputFilesPaging.currentPage).to.equal(1);
      expect(wi.inputFilesPaging.lastPage).to.equal(2); // ceil(60 / 50)
      expect(wi.inputFilesPaging.total).to.equal(60);
      const next = wi.inputFilesPaging.links.find((l) => l.rel === 'next');
      expect(next.href).to.include(`workitem${inputPagedWiId}inputpage=2`);
      expect(wi.inputFilesPaging.links.find((l) => l.rel === 'prev')).to.be.undefined;
    });
  });

  describe('Requesting the last page of a work item\'s input files', function () {
    before(async function () {
      this.res = await jobSteps(this.frontend, {
        jobID: inputPagedJob.jobID,
        query: { workItem: inputPagedWiId, resolveFiles: 'input', [`workItem${inputPagedWiId}InputPage`]: 2 },
      }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('returns the remaining input files with a prev link and no next', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      expect(wi.inputFiles).to.have.lengthOf(10); // items 50..59
      expect(wi.inputFiles[0]).to.equal('https://example.com/input50.nc4');
      expect(wi.inputFilesPaging.currentPage).to.equal(2);
      expect(wi.inputFilesPaging.links.find((l) => l.rel === 'prev').href)
        .to.include(`workitem${inputPagedWiId}inputpage=1`);
      expect(wi.inputFilesPaging.links.find((l) => l.rel === 'next')).to.be.undefined;
    });
  });

  describe('Requesting an input-file page past the last page', function () {
    before(async function () {
      this.res = await jobSteps(this.frontend, {
        jobID: inputPagedJob.jobID,
        query: { workItem: inputPagedWiId, resolveFiles: 'input', [`workItem${inputPagedWiId}InputPage`]: 9 },
      }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('returns the last page instead of an empty page', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const wi = body.steps[0].workItems[0];
      expect(wi.inputFiles).to.have.lengthOf(10);
      expect(wi.inputFilesPaging.currentPage).to.equal(2);
      expect(wi.inputFilesPaging.lastPage).to.equal(2);
    });
  });

  describe('For a job written to a user destinationUrl bucket', function () {
    before(async function () {
      this.res = await jobSteps(this.frontend, {
        jobID: destBucketJob.jobID, query: { workItem: destWiId, resolveFiles: 'output' },
      }).use(auth({ username: 'joe' }));
    });
    after(function () { delete this.res; });

    it('displays a generic asset and passes the destination-bucket href through', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const workItem = body.steps[0].workItems[0];
      expect(workItem.outputFiles).to.deep.equal(['s3://user-bucket/out/granule_reformatted.tif']);
      expect(workItem).to.not.have.property('outputFilesPaging');
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

    it('caps the work items at DEFAULT_WORKITEMS_PER_PAGE and adds a paging block with links', function () {
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

    it('defaults limit to MAX_WORKITEMS_PER_PAGE and pages', function () {
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

    it('returns the last page of work items instead of an empty page', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      const step = body.steps[0];
      // 51 items over a 50-item page: page 4 is limited to the last page (2)
      // with one item.
      expect(step.workItems).to.have.lengthOf(1);
      expect(step.paging.currentPage).to.equal(2);
      expect(step.paging.lastPage).to.equal(2);
      expect(step.paging.total).to.equal(51);
      expect(step.paging.links.find((l) => l.rel === 'prev').href).to.include('step1page=1');
      expect(step.paging.links.find((l) => l.rel === 'next')).to.be.undefined;
    });
  });

  describe('When a status filter and page query go beyond the last page', function () {
    hookJobSteps({
      jobID: destBucketJob.jobID, username: 'joe', query: { status: 'successful', step1Page: 4 },
    });

    it('keeps the step and returns the last page of matching work items', function () {
      expect(this.res.statusCode).to.equal(200);
      const body = JSON.parse(this.res.text);
      expect(body.steps).to.have.lengthOf(1);
      const step = body.steps[0];
      // The single matching item fits on one page, so there is no paging block.
      expect(step.workItems).to.have.lengthOf(1);
      expect(step.paging).to.be.undefined;
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

    describe('?status=failed,bogus (one invalid value in a list)', function () {
      hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { status: 'failed,bogus' } });
      it('returns 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });
    });

    describe('?step=1,abc (one non-integer value in a list)', function () {
      hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { step: '1,abc' } });
      it('returns 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });
    });

    describe('?workItem=1,-2 (one non-positive value in a list)', function () {
      hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { workItem: '1,-2' } });
      it('returns 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });
    });

    describe('?step1Page=0', function () {
      hookJobSteps({ jobID: pagedJob.jobID, username: 'joe', query: { step1Page: 0 } });
      it('returns 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Parameter "step1page" is invalid. Must be an integer greater than or equal to 1.',
        });
      });
    });

    describe('an unrecognized parameter name', function () {
      hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { staus: 'failed' } });
      it('returns 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error listing the invalid parameter', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Invalid parameter(s): staus. Allowed parameters are: step, status, workItem, limit, wiLimit, and resolveFiles.',
        });
      });
    });

    describe('?resolveFiles=bogus (invalid value)', function () {
      hookJobSteps({
        jobID: joeJob.jobID, username: 'joe', query: { workItem: 1, resolveFiles: 'bogus' },
      });
      it('returns 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });
    });

    describe('?resolveFiles=input without a workItem filter', function () {
      hookJobSteps({ jobID: joeJob.jobID, username: 'joe', query: { resolveFiles: 'input' } });
      it('returns 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('explains that one or more workItems are required', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: resolveFiles requires one or more workItems',
        });
      });
    });

    describe('?resolveFiles=input with more than one workItem', function () {
      before(async function () {
        this.res = await jobSteps(this.frontend, {
          jobID: joeJob.jobID, query: { workItem: `${wi1Id},${wi2Id}`, resolveFiles: 'input' },
        }).use(auth({ username: 'joe' }));
      });
      after(function () { delete this.res; });

      it('returns 200', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('resolves files inline for each requested work item', function () {
        const body = JSON.parse(this.res.text);
        const workItems = body.steps.flatMap((s) => s.workItems);
        expect(workItems.map((wi) => wi.id)).to.have.members([wi1Id, wi2Id]);
        for (const wi of workItems) {
          expect(wi).to.not.have.property('inputFilesUrl');
          expect(wi.inputFiles).to.be.an('array');
        }
      });
    });

  });
});
