import { expect } from 'chai';
import { describe, it } from 'mocha';
import { JobStatus } from '../app/models/job';
import { populateUserWorkFromWorkItems } from '../app/models/user-work';
import { WorkItemStatus } from '../app/models/work-item-interface';
import db from '../app/util/db';
import { truncateAll } from './helpers/db';
import { buildJob } from './helpers/jobs';
import hookServersStartStop from './helpers/servers';
import { hookServiceMetrics } from './helpers/service-metrics';
import { buildWorkItem } from './helpers/work-items';
import { buildWorkflowStep } from './helpers/workflow-steps';

/**
 * Creates a job with the given status and work items for that job
 *
 * @param serviceID - the ID of the service for the work items
 * @param jobStatus - the status of the job
 */
async function createJobAndWorkItems(serviceID: string, jobStatus: JobStatus): Promise<void> {
  await truncateAll();
  const job = buildJob({ status: jobStatus });

  await job.save(db);

  await buildWorkflowStep({
    jobID: job.jobID,
    serviceID,
    stepIndex: 1,
    workItemCount: 4,
  }).save(db);

  for (let i = 0; i < 2; i++) {
    await buildWorkItem({
      jobID: job.jobID,
      serviceID,
      status: WorkItemStatus.READY,
      workflowStepIndex: 1,
    }).save(db);
  }

  await buildWorkItem({
    jobID: job.jobID,
    serviceID,
    status: WorkItemStatus.RUNNING,
    workflowStepIndex: 1,
  }).save(db);

  await buildWorkItem({
    jobID: job.jobID,
    serviceID,
    status: WorkItemStatus.SUCCESSFUL,
    workflowStepIndex: 1,
  }).save(db);

  await buildWorkItem({
    jobID: job.jobID,
    serviceID,
    status: WorkItemStatus.FAILED,
    workflowStepIndex: 1,
  }).save(db);

  await populateUserWorkFromWorkItems(db);
}

describe('Backend service metrics endpoint', function () {

  hookServersStartStop({ skipEarthdataLogin: true });

  describe('when hitting the service/metrics endpoint without serviceID parameter', function () {
    hookServiceMetrics();

    it('returns 400 status code', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns JSON content', function () {
      expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
    });

    it('returns expected message', function () {
      expect(this.res.text).to.equal('{"code":"harmony.RequestValidationError","description":"Error: required parameter \\"serviceID\\" was not provided"}');
    });
  });

  describe('when hitting the service/metrics endpoint with a non-existing serviceID', function () {
    const serviceID = 'noexisting/service:version';
    hookServiceMetrics(serviceID);

    it('returns 200 status code', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns JSON content', function () {
      expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
    });

    it('returns expected message', function () {
      expect(JSON.stringify(this.res.body)).to.equal(JSON.stringify({ availableWorkItems: 0 }));
    });
  });

  describe('when hitting the service/metrics endpoint with an existing serviceID', async function () {
    const serviceID = 'harmony/query-cmr:latest';

    // The number of work items that should be returned for each of the job statuses
    const testParametersList = [
      { jobStatus: JobStatus.ACCEPTED, itemCount: 3 },
      { jobStatus: JobStatus.RUNNING, itemCount: 3 },
      { jobStatus: JobStatus.RUNNING_WITH_ERRORS, itemCount: 3 },
      { jobStatus: JobStatus.PAUSED, itemCount: 0 },
      { jobStatus: JobStatus.PREVIEWING, itemCount: 0 },
      { jobStatus: JobStatus.CANCELED, itemCount: 0 },
      { jobStatus: JobStatus.FAILED, itemCount: 0 },
      { jobStatus: JobStatus.COMPLETE_WITH_ERRORS, itemCount: 0 },
    ];

    for (const testParameters of testParametersList) {
      const { jobStatus, itemCount } = testParameters;

      describe(`with a job status of ${jobStatus}`, async function () {
        before(async function () {
          await createJobAndWorkItems(serviceID, jobStatus);
        });

        hookServiceMetrics(serviceID);

        it('returns 200 status code', function () {
          expect(this.res.statusCode).to.equal(200);
        });

        it('returns json content', function () {
          expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
        });

        it('returns expected number of work items', function () {
          expect(JSON.stringify(this.res.body)).to.equal(JSON.stringify({ availableWorkItems: itemCount }));
        });
      });
    }
  });
});