import { expect } from 'chai';
import { checkRemainingStepsForCompletion } from '../../app/backends/workflow-orchestration/work-item-updates';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import WorkItem from '../../app/models/work-item';
import { getWorkflowStepByJobIdStepIndex } from '../../app/models/workflow-steps';
import db from '../../app/util/db';
import { truncateAll } from '../helpers/db';
import { rawSaveWorkItem } from '../helpers/work-items';
import { rawSaveWorkflowStep } from '../helpers/workflow-steps';

describe('Finalize via the checkRemainingStepsForCompletion function', function () {

  const jobID = 'job-stranded-uuid';
  const queryCmrService = 'harmony/query-cmr-step:1.0.0';
  const hossService = 'harmony/hoss-step:2.0.0';
  const maskFillService = 'harmony/maskfill-step:3.0.0';

  describe('when HOSS has two work items and the second fails after the first chain completes', function () {

    let secondHoss: WorkItem;

    before(async function () {
      // Upstream step is already complete; hoss and the downstream maskfill
      // step are not yet marked complete.
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: queryCmrService, stepIndex: 1, is_complete: true,
      });
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: hossService, stepIndex: 2, is_complete: false,
      });
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: maskFillService, stepIndex: 3, is_complete: false,
      });

      // The first hoss work item already finished and its downstream maskfill
      // work item ran to completion. A second hoss work item is still running,
      // which is why the hoss step has not been marked complete.
      const now = new Date();
      await rawSaveWorkItem(db, {
        jobID, serviceID: hossService, workflowStepIndex: 2, status: WorkItemStatus.SUCCESSFUL,
        createdAt: now, updatedAt: now,
      });
      await rawSaveWorkItem(db, {
        jobID, serviceID: maskFillService, workflowStepIndex: 3, status: WorkItemStatus.SUCCESSFUL,
        createdAt: now, updatedAt: now,
      });
      secondHoss = await rawSaveWorkItem(db, {
        jobID, serviceID: hossService, workflowStepIndex: 2, status: WorkItemStatus.RUNNING,
        createdAt: now, updatedAt: now,
      });
    });

    after(async function () {
      await truncateAll();
    });

    it('has not yet marked the hoss step complete', async function () {
      const hossStep = await getWorkflowStepByJobIdStepIndex(db, jobID, 2);
      expect(hossStep.is_complete).to.equal(0);
    });

    it('has completed the metadata steps, but not marked them as complete', async function () {
      const maskFillStep = await getWorkflowStepByJobIdStepIndex(db, jobID, 3);
      expect(maskFillStep.is_complete).to.equal(0);
    });

    describe('when the second HOSS step fails.', function () {
      let result: boolean;

      before(async function () {
        secondHoss.status = WorkItemStatus.FAILED;
        await secondHoss.save(db);

        const hossStep = await getWorkflowStepByJobIdStepIndex(db, jobID, 2);
        result = await checkRemainingStepsForCompletion(db, jobID, hossStep);
      });

      it('marks the hoss step complete', async function () {
        const step = await getWorkflowStepByJobIdStepIndex(db, jobID, 2);
        expect(step.is_complete).to.equal(1);
      });

      it('marks the downstream maskfill step complete', async function () {
        const step = await getWorkflowStepByJobIdStepIndex(db, jobID, 3);
        expect(step.is_complete).to.equal(1);
      });

      it('returns true', function () {
        expect(result).to.equal(true);
      });
    });
  });
});
