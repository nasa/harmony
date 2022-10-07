import { WorkItemStatus, getStacLocation, WorkItemRecord } from './../../app/models/work-item-interface';
import { Job, JobRecord, JobStatus, terminalStates } from './../../app/models/job';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import MockDate from 'mockdate';
import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import WorkItem, { getWorkItemById } from '../../app/models/work-item';
import { WorkflowStepRecord } from '../../app/models/workflow-steps';
import hookServersStartStop from '../helpers/servers';
import db from '../../app/util/db';
import * as workflowOrchestration from '../../app/backends/workflow-orchestration';
import { hookJobCreation } from '../helpers/jobs';
import { hookGetWorkForService, hookWorkItemCreation, hookWorkItemUpdate, hookWorkflowStepAndItemCreation, getWorkForService, fakeServiceStacOutput, updateWorkItem } from '../helpers/work-items';
import { hookWorkflowStepCreation, validOperation } from '../helpers/workflow-steps';

const oldDate = '1/1/2000'; // "old" work items will get created on this date

describe('Work Backends', function () {
  const requestId = uuid().toString();
  const jobRecord = { jobID: requestId, requestId } as Partial<JobRecord>;
  const service = 'harmonyservices/query-cmr';
  const expectedLink = 'https://harmony.uat.earthdata.nasa.gov/service-results/harmony-uat-staging/public/harmony_example/nc/001_00_8f00ff_global.nc';

  const workItemRecord = {
    jobID: jobRecord.jobID,
    serviceID: service,
    id: 1,
  } as Partial<WorkItemRecord>;

  const workflowStepRecord = {
    jobID: jobRecord.jobID,
    serviceID: service,
    stepIndex: 0,
    workItemCount: 1,
    operation: validOperation,
  } as Partial<WorkflowStepRecord>;

  hookServersStartStop({ skipEarthdataLogin: true });

  describe('when getting a work item', function () {
    const runningJob = new Job({
      jobID: 'ABCD',
      requestId,
      status: JobStatus.RUNNING,
      username: 'anonymous',
      request: 'http://example.com/harmony?foo=bar',
      numInputGranules: 100,
      collectionIds: [],
    });

    const pausedJob = new Job({
      jobID: 'PAUSED',
      requestId,
      status: JobStatus.PAUSED,
      username: 'anonymous',
      request: 'http://example.com/harmony?foo=bar',
      numInputGranules: 100,
      collectionIds: [],
    });
    before(async () => {
      await runningJob.save(db);
      await pausedJob.save(db);
    });

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

    const pausedJobWorkItem = {
      serviceID: 'thePausedJobService',
      status: WorkItemStatus.READY,
      jobID: 'PAUSED',
      scrollID: '-1234',
      stacCatalogLocation: '/tmp/catalog.json',
      stepIndex: 3,
    };

    const pausedJobQueryCmrWorkItem = {
      serviceID: 'query-cmr',
      status: WorkItemStatus.READY,
      jobID: 'PAUSED',
      scrollID: '-1234',
      stacCatalogLocation: '/tmp/catalog.json',
      stepIndex: 1,
    };

    hookWorkflowStepAndItemCreation(readyWorkItem);
    hookWorkflowStepAndItemCreation(runningWorkItem);
    hookWorkflowStepAndItemCreation(pausedJobWorkItem);
    hookWorkflowStepAndItemCreation(pausedJobQueryCmrWorkItem);

    describe('when no work item is available for the service', function () {
      hookGetWorkForService('noWorkService');

      it('returns a 404', function () {
        expect(this.res.status).to.equal(404);
      });
    });

    describe('when work items are available, but their job is paused', function () {
      hookGetWorkForService('thePausedJobService');

      it('returns a 404', function () {
        expect(this.res.status).to.equal(404);
      });
    });

    // CMR work items are returned even when a job is paused to avoid a scroll session timeout
    describe('when work items are available for query-cmr, but their job is paused', function () {
      hookGetWorkForService('query-cmr');

      it('returns a 200', function () {
        expect(this.res.status).to.equal(200);
      });
    });

    describe('when work items are available for a paused job that is resumed', async function () {
      it('returns a 200', async function () {
        pausedJob.updateStatus(JobStatus.RUNNING);
        await pausedJob.save(db);
        const result = await getWorkForService(this.backend, 'thePausedJobService');
        expect(result.status).to.equal(200);
      });

    });

    describe('when a work item is in the ready state for the service', function () {
      hookGetWorkForService('theReadyService');

      it('returns a 200', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns the correct fields for a work item', function () {
        expect(Object.keys(this.res.body.workItem)).to.eql([
          'id', 'jobID', 'createdAt', 'retryCount', 'updatedAt', 'scrollID', 'serviceID', 'status',
          'stacCatalogLocation', 'totalGranulesSize', 'workflowStepIndex', 'duration',
          'startedAt', 'operation',
        ]);
      });

      it('returns the expected service ID', function () {
        expect(this.res.body.workItem.serviceID).to.equal('theReadyService');
      });

      it('returns the expected operation', function () {
        expect(this.res.body.workItem.operation).to.eql(JSON.parse(validOperation));
      });

      it('returns the expected jobID', function () {
        expect(this.res.body.workItem.jobID).to.equal('ABCD');
      });

      it('returns a datetime string for createdAt', function () {
        expect(this.res.body.workItem.createdAt).to.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/);
      });

      it('returns a datetime string for updatedAt', function () {
        expect(this.res.body.workItem.updatedAt).to.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/);
      });

      it('returns the expected scrollID', function () {
        expect(this.res.body.workItem.scrollID).to.equal('-1234');
      });

      it('returns the expected stac catalog location', function () {
        expect(this.res.body.workItem.stacCatalogLocation).to.equal('/tmp/catalog.json');
      });

      it('returns the expected workflow step index', function () {
        expect(this.res.body.workItem.workflowStepIndex).to.equal(3);
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

  describe('Updating a work item', function () {
    describe('when the work item failed', async function () {
      hookJobCreation(jobRecord);
      hookWorkflowStepCreation(workflowStepRecord);
      hookWorkItemCreation(workItemRecord);
      before(async function () {
        let shouldLoop = true;
        // retrieve and fail work items until one exceeds the retry limit and actually gets marked as failed
        while (shouldLoop) {
          const res = await getWorkForService(this.backend, workItemRecord.serviceID);
          if (res.text) {
            const tmpWorkItem = JSON.parse(res.text).workItem as WorkItem;
            tmpWorkItem.status = WorkItemStatus.FAILED;
            tmpWorkItem.results = [];
            tmpWorkItem.outputGranuleSizes = [];

            await updateWorkItem(this.backend, tmpWorkItem);

            // check to see if the work-item has failed completely
            const workItem = await getWorkItemById(db, this.workItem.id);
            shouldLoop = !(workItem.status === WorkItemStatus.FAILED);
          }
        }
      });

      it('sets the work item status to failed', async function () {
        const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
        expect(updatedWorkItem.status).to.equal(WorkItemStatus.FAILED);
      });

      it('sets the job status to failed', async function () {
        const job = await Job.byJobID(db, this.job.jobID);
        expect(job.status).to.equal(JobStatus.FAILED);
      });
    });

    describe('output granules sizes', async function () {
      let readSTACCatalogStub: SinonStub;
      let sizeOfObjectStub: SinonStub;
      describe('when a work item provides all the granule sizes', async function () {
        hookJobCreation(jobRecord);
        hookWorkflowStepCreation(workflowStepRecord);
        const runningWorkItemRecord = {
          ...workItemRecord,
          ...{
            status: WorkItemStatus.RUNNING,
            startedAt: new Date(),
          },
        };
        hookWorkItemCreation(runningWorkItemRecord);
        const successfulWorkItemRecord = {
          ...workItemRecord,
          ...{
            status: WorkItemStatus.SUCCESSFUL,
            results: [getStacLocation({ id: workItemRecord.id, jobID: workItemRecord.jobID }, 'catalog.json')],
            scrollID: '-1234',
            duration: 0,
            outputGranuleSizes: [12340000000000, 5678],
          },
        };
        before(async () => {
          await fakeServiceStacOutput(successfulWorkItemRecord.jobID, successfulWorkItemRecord.id);
          readSTACCatalogStub = sinon.stub(workflowOrchestration, 'readSTACCatalog');
          sizeOfObjectStub = sinon.stub(workflowOrchestration, 'sizeOfObject');
        });
        after(async () => {
          readSTACCatalogStub.restore();
          sizeOfObjectStub.restore();
        });
        hookWorkItemUpdate((r) => r.send(successfulWorkItemRecord));

        it('does not read the STAC catalog', async function () {
          expect(readSTACCatalogStub.callCount).to.equal(0);
        });

        it('does not look up the granule sizes', async function () {
          expect(sizeOfObjectStub.callCount).to.equal(0);
        });

        it('uses the granule sizes provided by the service', async function () {
          const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
          expect(updatedWorkItem.outputGranuleSizes).to.eql(successfulWorkItemRecord.outputGranuleSizes);
        });
      });

      describe('when a work item provides some of the granule sizes', async function () {
        hookJobCreation(jobRecord);
        hookWorkflowStepCreation(workflowStepRecord);
        const runningWorkItemRecord = {
          ...workItemRecord,
          ...{
            status: WorkItemStatus.RUNNING,
            startedAt: new Date(),
          },
        };
        hookWorkItemCreation(runningWorkItemRecord);
        const successfulWorkItemRecord = {
          ...workItemRecord,
          ...{
            status: WorkItemStatus.SUCCESSFUL,
            results: [getStacLocation({ id: workItemRecord.id, jobID: workItemRecord.jobID }, 'catalog.json')],
            scrollID: '-1234',
            duration: 0,
            outputGranuleSizes: [12340000000000, 0],
          },
        };
        before(async () => {
          await fakeServiceStacOutput(successfulWorkItemRecord.jobID, successfulWorkItemRecord.id);
          readSTACCatalogStub = sinon.stub(workflowOrchestration, 'readSTACCatalog')
            .callsFake(async (_) => ['s3://abc/foo.nc', 'http://abc/bar.nc']);
          sizeOfObjectStub = sinon.stub(workflowOrchestration, 'sizeOfObject')
            .callsFake(async (_) => 7000000000);
        });
        after(async () => {
          readSTACCatalogStub.restore();
          sizeOfObjectStub.restore();
        });
        hookWorkItemUpdate((r) => r.send(successfulWorkItemRecord));

        it('reads the STAC catalog', async function () {
          expect(readSTACCatalogStub.callCount).to.equal(1);
        });

        it('looks up the missing the granule sizes', async function () {
          expect(sizeOfObjectStub.callCount).to.equal(1);
        });

        it('uses the granule sizes provided by the service', async function () {
          const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
          expect(updatedWorkItem.outputGranuleSizes).to.eql([12340000000000, 7000000000]);
        });
      });

      describe('when a work item does not provide granule sizes', async function () {
        hookJobCreation(jobRecord);
        hookWorkflowStepCreation(workflowStepRecord);
        const runningWorkItemRecord = {
          ...workItemRecord,
          ...{
            status: WorkItemStatus.RUNNING,
            startedAt: new Date(),
          },
        };
        hookWorkItemCreation(runningWorkItemRecord);
        const successfulWorkItemRecord = {
          ...workItemRecord,
          ...{
            status: WorkItemStatus.SUCCESSFUL,
            results: [getStacLocation({ id: workItemRecord.id, jobID: workItemRecord.jobID }, 'catalog.json')],
            scrollID: '-1234',
            duration: 0,
          },
        };
        before(async () => {
          await fakeServiceStacOutput(successfulWorkItemRecord.jobID, successfulWorkItemRecord.id);
          readSTACCatalogStub = sinon.stub(workflowOrchestration, 'readSTACCatalog')
            .callsFake(async (_) => ['s3://abc/foo.nc', 'http://abc/bar.nc']);
          sizeOfObjectStub = sinon.stub(workflowOrchestration, 'sizeOfObject')
            .callsFake(async (_) => 7000000000);
        });
        after(async () => {
          readSTACCatalogStub.restore();
          sizeOfObjectStub.restore();
        });
        hookWorkItemUpdate((r) => r.send(successfulWorkItemRecord));

        it('reads the STAC catalog', async function () {
          expect(readSTACCatalogStub.callCount).to.equal(1);
        });

        it('looks up the granule sizes', async function () {
          expect(sizeOfObjectStub.callCount).to.equal(2);
        });

        it('uses the granule sizes provided by the service', async function () {
          const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
          expect(updatedWorkItem.outputGranuleSizes).to.eql([7000000000, 7000000000]);
        });
      });
    });

    describe('when the work item succeeded', async function () {
      hookJobCreation(jobRecord);
      hookWorkflowStepCreation(workflowStepRecord);
      const runningWorkItemRecord = {
        ...workItemRecord,
        ...{
          status: WorkItemStatus.RUNNING,
          startedAt: new Date(),
        },
      };
      hookWorkItemCreation(runningWorkItemRecord);
      const successfulWorkItemRecord = {
        ...workItemRecord,
        ...{
          status: WorkItemStatus.SUCCESSFUL,
          results: [getStacLocation({ id: workItemRecord.id, jobID: workItemRecord.jobID }, 'catalog.json')],
          outputGranuleSizes: [1],
          scrollID: '-1234',
          duration: 0,
        },
      };
      before(async () => {
        await fakeServiceStacOutput(successfulWorkItemRecord.jobID, successfulWorkItemRecord.id);
      });
      hookWorkItemUpdate((r) => r.send(successfulWorkItemRecord));

      it('sets the work item status to successful', async function () {
        const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
        expect(updatedWorkItem.status).to.equal(WorkItemStatus.SUCCESSFUL);
      });

      describe('and the worker computed duration is less than the harmony computed duration', async function () {
        it('sets the work item duration to the harmony computed duration', async function () {
          const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
          expect(updatedWorkItem.duration).to.be.greaterThan(successfulWorkItemRecord.duration);
        });
      });

      describe('and the work item is the last in the chain', async function () {
        it('sets the job updatedAt field to the current time', async function () {
          const updatedJob = await Job.byJobID(db, this.job.jobID);
          expect(updatedJob.updatedAt.valueOf()).to.greaterThan(this.job.updatedAt.valueOf());
        });

        it('adds a link for the work results to the job', async function () {
          const updatedJob = await Job.byJobID(db, this.job.jobID);
          expect(updatedJob.links.filter(
            (jobLink) => jobLink.href === expectedLink,
          ).length).to.equal(1);
        });

        it('sets the job status to complete', async function () {
          const updatedJob = await Job.byJobID(db, this.job.jobID);
          expect(updatedJob.status === JobStatus.SUCCESSFUL);
        });

        it('sets the job progress to 100', async function () {
          const updatedJob = await Job.byJobID(db, this.job.jobID);
          expect(updatedJob.progress).to.equal(100);
        });
      });
    });

    describe('when a retried work item succeeds on the original worker before the retry finishes', async function () {
      hookJobCreation(jobRecord);
      hookWorkflowStepCreation(workflowStepRecord);
      const runningWorkItemRecord = {
        ...workItemRecord,
        ...{
          status: WorkItemStatus.RUNNING,
          startedAt: new Date(),
        },
      };
      hookWorkItemCreation(runningWorkItemRecord);
      const successfulWorkItemRecord = {
        ...workItemRecord,
        ...{
          status: WorkItemStatus.SUCCESSFUL,
          results: [getStacLocation({ id: workItemRecord.id, jobID: workItemRecord.jobID }, 'catalog.json')],
          outputGranuleSizes: [1],
          scrollID: '-1234',
          duration: 100000000,
        },
      };
      before(async () => {
        await fakeServiceStacOutput(successfulWorkItemRecord.jobID, successfulWorkItemRecord.id);
      });
      hookWorkItemUpdate((r) => r.send(successfulWorkItemRecord));

      describe('so the worker computed duration is longer than the harmony computed duration', async function () {
        before(async () => {
          MockDate.set(oldDate);
        });
        after(() => {
          MockDate.reset();
        });
        it('sets the work item duration to the worker computed duration', async function () {
          const updatedWorkItem = await getWorkItemById(db, this.workItem.id);
          expect(updatedWorkItem.duration).to.equal(successfulWorkItemRecord.duration);
        });
      });
    });

    // tests to make sure work-items cannot be updated for jobs in a terminal state
    // with the exception that we do allow canceling work-items
    for (const terminalState of terminalStates) {
      describe(`When the job is already in state "${terminalState}"`, async function () {
        hookJobCreation({ ...jobRecord, ...{ status: terminalState } });
        hookWorkflowStepCreation(workflowStepRecord);
        hookWorkItemCreation(workItemRecord);
        for (const updateState of Object.values(WorkItemStatus).filter(k => k !== WorkItemStatus.CANCELED)) {
          describe(`And an attempt is made to update the work-item to state "${updateState}"`, async function () {
            before(async function () {
              this.workItem.status = updateState;
              await updateWorkItem(this.backend, this.workItem);
            });
            it('fails the update', async function () {
              const workItem = await getWorkItemById(db, workItemRecord.id);
              expect(workItem.status).to.equal(WorkItemStatus.READY);
            });
          });
        }
      });
    }

    // tests to make sure work-items cannot be updated once they are in a terminal state
    for (const terminalState of [WorkItemStatus.CANCELED, WorkItemStatus.FAILED, WorkItemStatus.SUCCESSFUL]) {
      describe(`When the work-item is already in state "${terminalState}"`, async function () {
        const newWorkItemRecord = {
          ...workItemRecord, ...{ status: terminalState },
        };
        hookJobCreation(jobRecord);
        hookWorkflowStepCreation(workflowStepRecord);
        hookWorkItemCreation(newWorkItemRecord);
        for (const updateState of Object.values(WorkItemStatus)) {
          describe(`And an attempt is made to update the work-item to state "${updateState}"`, async function () {
            before(async function () {
              this.workItem.status = updateState;
              await updateWorkItem(this.backend, this.workItem);
            });
            it('fails to update the work item', async function () {
              const workItem = await getWorkItemById(db, workItemRecord.id);
              expect(workItem.status).to.equal(terminalState);
            });
          });
        }
      });
    }
  });
});
