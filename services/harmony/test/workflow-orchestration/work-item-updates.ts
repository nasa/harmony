import { expect } from 'chai';

import { checkRemainingStepsForCompletion } from '../../app/backends/workflow-orchestration/work-item-updates';
import WorkItem from '../../app/models/work-item';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import { getWorkflowStepByJobIdStepIndex } from '../../app/models/workflow-steps';
import db from '../../app/util/db';
import { truncateAll } from '../helpers/db';
import { createUserWorkRecord, rowExists } from '../helpers/user-work';
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
      // Upstream step is already complete; HOSS and the downstream maskfill
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

      // The first HOSS work item already finished and its downstream maskfill
      // work item ran to completion. A second HOSS work item is still running,
      // which is why the HOSS step has not been marked complete.
      await rawSaveWorkItem(db, {
        jobID, serviceID: hossService, workflowStepIndex: 2, status: WorkItemStatus.SUCCESSFUL,
      });
      await rawSaveWorkItem(db, {
        jobID, serviceID: maskFillService, workflowStepIndex: 3, status: WorkItemStatus.SUCCESSFUL,
      });
      secondHoss = await rawSaveWorkItem(db, {
        jobID, serviceID: hossService, workflowStepIndex: 2, status: WorkItemStatus.RUNNING,
      });

      // user_work rows for both services so we can verify the function deletes
      // them as it walks the chain marking steps complete.
      await createUserWorkRecord({ job_id: jobID, service_id: hossService }).save(db);
      await createUserWorkRecord({ job_id: jobID, service_id: maskFillService }).save(db);
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

    it('has not yet deleted user_work for either service', async function () {
      expect(await rowExists(jobID, hossService)).to.equal(true);
      expect(await rowExists(jobID, maskFillService)).to.equal(true);
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

      it('deletes user_work for both completed services', async function () {
        expect(await rowExists(jobID, hossService)).to.equal(false);
        expect(await rowExists(jobID, maskFillService)).to.equal(false);
      });
    });
  });

  describe('when the HOSS step still has a running work item', function () {
    let result: boolean;

    before(async function () {
      // query-cmr is done; HOSS has one in-flight work item; maskfill exists
      // downstream with a SUCCESSFUL item from a sibling chain.
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: queryCmrService, stepIndex: 1, is_complete: true,
      });
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: hossService, stepIndex: 2, is_complete: false,
      });
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: maskFillService, stepIndex: 3, is_complete: false,
      });

      await rawSaveWorkItem(db, {
        jobID, serviceID: hossService, workflowStepIndex: 2, status: WorkItemStatus.RUNNING,
      });
      await rawSaveWorkItem(db, {
        jobID, serviceID: maskFillService, workflowStepIndex: 3, status: WorkItemStatus.SUCCESSFUL,
      });

      // user_work rows for both services so we can detect whether the loop
      // advanced past HOSS (deleteUserWorkForJobAndService is the per-iteration
      // side effect that fires after the completeness check passes).
      await createUserWorkRecord({ job_id: jobID, service_id: hossService }).save(db);
      await createUserWorkRecord({ job_id: jobID, service_id: maskFillService }).save(db);

      const hossStep = await getWorkflowStepByJobIdStepIndex(db, jobID, 2);
      result = await checkRemainingStepsForCompletion(db, jobID, hossStep);
    });

    after(async function () {
      await truncateAll();
    });

    it('returns false', function () {
      expect(result).to.equal(false);
    });

    it('does not mark the HOSS step complete', async function () {
      const step = await getWorkflowStepByJobIdStepIndex(db, jobID, 2);
      expect(step.is_complete).to.equal(0);
    });

    it('does not mark the downstream maskfill step complete', async function () {
      const step = await getWorkflowStepByJobIdStepIndex(db, jobID, 3);
      expect(step.is_complete).to.equal(0);
    });

    it('short-circuits before deleting any user_work rows', async function () {
      expect(await rowExists(jobID, hossService)).to.equal(true);
      expect(await rowExists(jobID, maskFillService)).to.equal(true);
    });
  });

  describe('when a 4 step chain has its last step still running', function () {
    let result: boolean;
    const net2cogService = 'harmony/net2cog-step:4.0.0';

    before(async function () {
      // query-cmr, HOSS, and maskfill are done; net2cog is the last step and still
      // has an in-flight work item.
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: queryCmrService, stepIndex: 1, is_complete: true,
      });
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: hossService, stepIndex: 2, is_complete: false,
      });
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: maskFillService, stepIndex: 3, is_complete: false,
      });
      await rawSaveWorkflowStep(db, {
        jobID, serviceID: net2cogService, stepIndex: 4, is_complete: false,
      });


      await rawSaveWorkItem(db, {
        jobID, serviceID: hossService, workflowStepIndex: 2, status: WorkItemStatus.SUCCESSFUL,
      });
      await rawSaveWorkItem(db, {
        jobID, serviceID: maskFillService, workflowStepIndex: 3, status: WorkItemStatus.SUCCESSFUL,
      });
      await rawSaveWorkItem(db, {
        jobID, serviceID: net2cogService, workflowStepIndex: 4, status: WorkItemStatus.RUNNING,
      });

      // user_work rows for all three services so we can detect how far the loop
      // advanced before short-circuiting at net2cog.
      await createUserWorkRecord({ job_id: jobID, service_id: hossService }).save(db);
      await createUserWorkRecord({ job_id: jobID, service_id: maskFillService }).save(db);
      await createUserWorkRecord({ job_id: jobID, service_id: net2cogService }).save(db);

      const hossStep = await getWorkflowStepByJobIdStepIndex(db, jobID, 2);
      result = await checkRemainingStepsForCompletion(db, jobID, hossStep);
    });

    after(async function () {
      await truncateAll();
    });

    it('returns false', function () {
      expect(result).to.equal(false);
    });

    it('marks the HOSS step complete', async function () {
      const step = await getWorkflowStepByJobIdStepIndex(db, jobID, 2);
      expect(step.is_complete).to.equal(1);
    });

    it('marks the downstream maskfill step complete', async function () {
      const step = await getWorkflowStepByJobIdStepIndex(db, jobID, 3);
      expect(step.is_complete).to.equal(1);
    });

    it('does not mark the downstream net2cog step complete', async function () {
      const step = await getWorkflowStepByJobIdStepIndex(db, jobID, 4);
      expect(step.is_complete).to.equal(0);
    });

    it('short-circuits before deleting the net2cog user_work rows', async function () {
      expect(await rowExists(jobID, hossService)).to.equal(false);
      expect(await rowExists(jobID, maskFillService)).to.equal(false);
      expect(await rowExists(jobID, net2cogService)).to.equal(true);
    });
  });
});
