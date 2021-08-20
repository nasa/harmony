import { describe, it } from 'mocha';
import { expect } from 'chai';
import { Job, JobRecord } from 'models/job';
import { WorkItemRecord, WorkItemStatus, getWorkItemById } from 'models/work-item';
import { v4 as uuid } from 'uuid';
import { JobStatus } from 'tasks/service-wrapper/built/app/models/job';
import { WorkflowStepRecord } from 'models/workflow-steps';
import hookServersStartStop from './helpers/servers';
import db from '../app/util/db';
import { hookJobCreationEach } from './helpers/jobs';
import { hookGetWorkForService, hookWorkItemCreationEach, hookWorkItemUpdateEach, hookWorkflowStepAndItemCreationEach, hookWorkItemUpdate } from './helpers/work-items';
import { hookWorkflowStepCreationEach, validOperation } from './helpers/workflow-steps';

describe('Work Backends', function () {
  const requestId = uuid().toString();
  const jobRecord = { jobID: requestId, requestId } as Partial<JobRecord>;
  const service = 'harmonyservices/query-cmr';
  const expectedLink = 'https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc';

  const workItemRecord = {
    jobID: jobRecord.jobID,
    serviceID: service,
  } as Partial<WorkItemRecord>;

  const workflowStepRecod = {
    jobID: jobRecord.jobID,
    serviceID: service,
    stepIndex: 0,
    workItemCount: 1,
    operation: validOperation,
  } as Partial<WorkflowStepRecord>;

  hookServersStartStop({ skipEarthdataLogin: true });
  hookJobCreationEach(jobRecord);
  hookWorkflowStepCreationEach(workflowStepRecod);
  hookWorkItemCreationEach(workItemRecord);

  describe('getting a work item', function () {
    const readyWorkItem = {
      serviceID: 'theReadyService',
      status: WorkItemStatus.READY,
      jobID: 'ABCD',
      scrollID: '-1234',
      stacCatalogLocation: '/tmp/catalog.json',
      stepIndex: 3,
    };

    const runningWorkItem = {
      serviceID: 'theRunningService',
      status: WorkItemStatus.RUNNING,
      jobID: 'RUN',
    };

    hookWorkflowStepAndItemCreationEach(readyWorkItem);
    hookWorkflowStepAndItemCreationEach(runningWorkItem);

    describe('when no work item is available for the service', function () {
      hookGetWorkForService('noWorkService');

      it('returns a 404', function () {
        expect(this.res.status).to.equal(404);
      });
    });

    describe('when a work item is in the ready state for the service', function () {
      hookGetWorkForService('theReadyService');

      it('returns a 200', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns the correct fields for a work item', function () {
        expect(Object.keys(this.res.body)).to.eql([
          'id', 'jobID', 'createdAt', 'updatedAt', 'scrollID', 'serviceID', 'status',
          'stacCatalogLocation', 'workflowStepIndex', 'operation',
        ]);
      });

      it('returns the expected service ID', function () {
        expect(this.res.body.serviceID).to.equal('theReadyService');
      });

      it('returns the expected operation', function () {
        expect(this.res.body.operation).to.eql(JSON.parse(validOperation));
      });

      it('returns the expected jobID', function () {
        expect(this.res.body.jobID).to.equal('ABCD');
      });

      it('returns a datetime string for createdAt', function () {
        expect(this.res.body.createdAt).to.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/);
      });

      it('returns a datetime string for updatedAt', function () {
        expect(this.res.body.updatedAt).to.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/);
      });

      it('returns the expected scrollID', function () {
        expect(this.res.body.scrollID).to.equal('-1234');
      });

      it('returns the expected stac catalog location', function () {
        expect(this.res.body.stacCatalogLocation).to.equal('/tmp/catalog.json');
      });

      it('returns the expected workflow step index', function () {
        expect(this.res.body.workflowStepIndex).to.equal(3);
      });
    });

    describe('when a work item is in the running state for the service', function () {
      hookGetWorkForService('theRunningService');

      it('returns a 404 (does not return the work item)', function () {
        expect(this.res.status).to.equal(404);
      });

      describe('when the work item has stayed in the running state longer than the configured timeout', function () {
        // Not implemented yet
      });
    });
  });

  describe('updating a work item', function () {
    describe('and the work item failed', async function () {
      const failedWorkItemRecord = {
        ...workItemRecord, ...{ status: WorkItemStatus.FAILED },
      };

      hookWorkItemUpdateEach((r) => r.send(failedWorkItemRecord));

      it('the work item status is set to failed', async function () {
        const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
        expect(updatedWorkItem.status).to.equal(WorkItemStatus.FAILED);
      });
      it('the job status is set to failed', async function () {
        const job = await Job.byJobID(db, this.job.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
      });
    });

    describe('and the work item succeeded', async function () {
      const successfulWorkItemRecord = {
        ...workItemRecord,
        ...{
          status: WorkItemStatus.SUCCESSFUL,
          results: ['test/resources/worker-response-sample/catalog0.json'],
        },
      };

      hookWorkItemUpdate((r) => r.send(successfulWorkItemRecord));

      it('the work item status is set to successful', async function () {
        const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
        expect(updatedWorkItem.status).to.equal(WorkItemStatus.SUCCESSFUL);
      });
      describe('and the work item is the last in the chain', async function () {
        it('the job updatedAt field is set to the current time', async function () {
          const updatedJob = await Job.byJobID(db, this.job.jobID);
          expect(updatedJob.updatedAt.valueOf()).to.greaterThan(this.job.updatedAt.valueOf());
        });
        it('a link for the work results is added to the job', async function () {
          const updatedJob = await Job.byJobID(db, this.job.jobID);
          expect(updatedJob.links.filter(
            (jobLink) => jobLink.href === expectedLink,
          ).length).to.equal(1);
        });
      });
    });
  });
});
