import { expect } from 'chai';
import { deleteStrandedUserWork } from '../../app/backends/workflow-orchestration/work-item-updates';
import db from '../../app/util/db';
import { truncateAll } from '../helpers/db';
import { createUserWorkRecord, rowExists } from '../helpers/user-work';
import { rawSaveWorkflowStep } from '../helpers/workflow-steps';

describe('Cleanup via the deleteStrandedUserWork function', function () {
  const jobID = 'job-stranded-uuid';
  const otherJobID = 'job-other-uuid';
  const step1Service = 'harmony/query-cmr-step-1:1.0.0';
  const step2Service = 'harmony/hoss-step-2:2.0.0';
  const step3Service = 'harmony/maskfill-step-3:3.0.0';


  describe('with an incomplete three-step job and an initial stepIndex of 2', function () {
    let result: boolean;

    before(async function () {
      await rawSaveWorkflowStep(db, { jobID, serviceID: step1Service, stepIndex: 1 });
      await rawSaveWorkflowStep(db, { jobID, serviceID: step2Service, stepIndex: 2 });
      await rawSaveWorkflowStep(db, { jobID, serviceID: step3Service, stepIndex: 3 });
      // Unrelated job sharing the same stepIndex and serviceID — should be left alone.
      await rawSaveWorkflowStep(db, { jobID: otherJobID, serviceID: step2Service, stepIndex: 2 });

      await createUserWorkRecord({
        job_id: jobID, service_id: step1Service, ready_count: 0, running_count: 0,
      }).save(db);
      await createUserWorkRecord({
        job_id: jobID, service_id: step2Service, ready_count: 0, running_count: 0,
      }).save(db);
      await createUserWorkRecord({
        job_id: jobID, service_id: step3Service, ready_count: 2, running_count: 0,
      }).save(db);
      await createUserWorkRecord({
        job_id: otherJobID, service_id: step2Service, ready_count: 0, running_count: 0,
      }).save(db);

      result = await deleteStrandedUserWork(db, jobID, 2);
    });

    after(async function () {
      await truncateAll();
    });

    it('leaves user_work for steps earlier than stepIndex untouched', async function () {
      expect(await rowExists(jobID, step1Service)).to.equal(true);
    });

    it('deletes user_work at or beyond stepIndex when ready and running counts are both 0', async function () {
      expect(await rowExists(jobID, step2Service)).to.equal(false);
    });

    it('leaves user_work at or beyond stepIndex when ready_count is non-zero', async function () {
      expect(await rowExists(jobID, step3Service)).to.equal(true);
    });

    it('does not touch user_work rows for other jobs', async function () {
      expect(await rowExists(otherJobID, step2Service)).to.equal(true);
    });

    it('returns false because step3 still has remaining work', async function () {
      expect(result).to.equal(false);
    });
  });

  describe('with a complete three-step job.', function () {
    let result: boolean;

    before(async function () {
      await rawSaveWorkflowStep(db, { jobID, serviceID: step1Service, stepIndex: 1 });
      await rawSaveWorkflowStep(db, { jobID, serviceID: step2Service, stepIndex: 2 });
      await rawSaveWorkflowStep(db, { jobID, serviceID: step3Service, stepIndex: 3 });

      await createUserWorkRecord({
        job_id: jobID, service_id: step1Service, ready_count: 5, running_count: 0,
      }).save(db);
      await createUserWorkRecord({
        job_id: jobID, service_id: step2Service, ready_count: 0, running_count: 0,
      }).save(db);
      await createUserWorkRecord({
        job_id: jobID, service_id: step3Service, ready_count: 0, running_count: 0,
      }).save(db);

      result = await deleteStrandedUserWork(db, jobID, 2);
    });

    after(async function () {
      await truncateAll();
    });

    it('deletes all rows for stepIndex and beyond', async function () {
      expect(await rowExists(jobID, step2Service)).to.equal(false);
      expect(await rowExists(jobID, step3Service)).to.equal(false);
    });

    it('returns true when no remaining work exists at or beyond stepIndex', async function () {
      expect(result).to.equal(true);
    });
  });

  describe('when a step at or beyond stepIndex has a non-zero running_count', function () {
    before(async function () {
      await rawSaveWorkflowStep(db, { jobID, serviceID: step2Service, stepIndex: 2 });

      await createUserWorkRecord({
        job_id: jobID, service_id: step2Service, ready_count: 0, running_count: 3,
      }).save(db);
    });

    after(async function () {
      await truncateAll();
    });

    it('leaves the row intact', async function () {
      await deleteStrandedUserWork(db, jobID, 2);
      expect(await rowExists(jobID, step2Service)).to.equal(true);
    });

    it('returns false', async function () {
      const result = await deleteStrandedUserWork(db, jobID, 2);
      expect(result).to.equal(false);
    });
  });

  describe('when stepIndex is beyond all workflow steps', function () {
    let result: boolean;

    before(async function () {
      await rawSaveWorkflowStep(db, { jobID, serviceID: step1Service, stepIndex: 1 });

      await createUserWorkRecord({
        job_id: jobID, service_id: step1Service, ready_count: 5, running_count: 0,
      }).save(db);

      result = await deleteStrandedUserWork(db, jobID, 99);
    });

    after(async function () {
      await truncateAll();
    });

    it('leaves all user_work rows untouched', async function () {
      expect(await rowExists(jobID, step1Service)).to.equal(true);
    });

    it('returns true when there are no steps to inspect', async function () {
      expect(result).to.equal(true);
    });
  });

});
