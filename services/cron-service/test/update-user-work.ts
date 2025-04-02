import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';

import { JobStatus } from '../../harmony/app/models/job';
import * as userWork from '../../harmony/app/models/user-work';
import db from '../../harmony/app/util/db';
import { createUserWorkRecord } from '../../harmony/test/helpers/user-work';
import * as updateUserWorkMod from '../app/cronjobs/update-user-work';
import { Context } from '../app/util/context';
import env from '../app/util/env';
import { truncateAll } from './helpers/db';
import { buildJob } from './helpers/jobs';

describe('UserWorkUpdater', () => {
  let ctx: Context;
  let loggerInfoStub: sinon.SinonStub;
  let loggerDebugStub: sinon.SinonStub;
  let loggerErrorStub: sinon.SinonStub;
  let recalculateCountsStub: sinon.SinonStub;
  let setReadyAndRunningCountToZeroStub: sinon.SinonStub;

  beforeEach(async () => {
    await truncateAll();
    // Set up logger stubs
    loggerInfoStub = sinon.stub();
    loggerDebugStub = sinon.stub();
    loggerErrorStub = sinon.stub();

    // Set up context with real database
    ctx = {
      logger: {
        info: loggerInfoStub,
        debug: loggerDebugStub,
        error: loggerErrorStub,
      },
      db: db,
    } as unknown as Context;

    // Set up recalculateCounts stub
    recalculateCountsStub = sinon.stub(userWork, 'recalculateCounts').resolves();

    // Set up setReadyAndRunningCountToZero stub
    setReadyAndRunningCountToZeroStub = sinon.stub(userWork, 'setReadyAndRunningCountToZero').resolves();

    // Set environment variables
    env.userWorkExpirationMinutes = 60;
  });

  afterEach(() => {
    setReadyAndRunningCountToZeroStub.reset();
    recalculateCountsStub.reset();
    sinon.restore();
  });

  describe('UserWorkUpdater.run', () => {
    it('should call logger.debug and execute updateUserWork', async () => {
      await updateUserWorkMod.UserWorkUpdater.run(ctx);

      expect(loggerDebugStub.calledOnceWith('Running')).to.be.true;
    });

    let trxStub: SinonStub;
    const error = new Error('Test error');

    it('should log errors when updateUserWork fails', async () => {
      trxStub = sinon.stub(db, 'transaction').rejects(error);
      loggerErrorStub.reset();

      try {

        await updateUserWorkMod.UserWorkUpdater.run(ctx);

      } finally {
        expect(loggerErrorStub.called).to.be.true;
        expect(loggerErrorStub.calledWith('User work udpater failed to update user-work table')).to.be.true;
        expect(loggerErrorStub.secondCall.args[0]).to.equal(error);
        trxStub.restore();
      }
    });
  });

  describe('updateUserWork', () => {
    it('should find and reset jobs with ready_count > 0 and outdated last_worked', async () => {
      // Insert test data - job with ready_count > 0 and outdated last_worked
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 2); // 2 hours ago (older than the 1 hour setting)
      const job1 = buildJob({});
      await job1.save(db);
      const job2 = buildJob({});
      await job2.save(db);
      const userWork1 = createUserWorkRecord({ job_id: job1.jobID, service_id: 'foo', ready_count: 5, running_count: 0, last_worked: pastDate });
      const userWork2 = createUserWorkRecord({ job_id: job2.jobID, service_id: 'bar', ready_count: 0, running_count: 0, last_worked: new Date() });
      await userWork1.save(db);
      await userWork2.save(db);

      await updateUserWorkMod.updateUserWork(ctx);

      // Should have called recalculateCounts for job1 only
      expect(recalculateCountsStub.callCount).to.equal(1);
      expect(recalculateCountsStub.firstCall.args[1]).to.equal(job1.jobID);

      expect(loggerInfoStub.calledWith(`Resetting user-work counts for job ${job1.jobID}`)).to.be.true;
    });

    it('should find and reset jobs with running_count > 0 and outdated last_worked', async () => {
      // Insert test data - job with running_count > 0 and outdated last_worked
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 2); // 2 hours ago

      const job1 = buildJob({});
      await job1.save(db);
      const job2 = buildJob({});
      await job2.save(db);

      const userWork3 = createUserWorkRecord({ job_id: job1.jobID, ready_count: 0, running_count: 3, last_worked: pastDate });
      await userWork3.save(db);
      await updateUserWorkMod.updateUserWork(ctx);

      // Should have called recalculateCounts for job3
      expect(recalculateCountsStub.callCount).to.equal(1);
      expect(recalculateCountsStub.calledWith(sinon.match.any, job1.jobID)).to.be.true;
      expect(recalculateCountsStub.calledWith(sinon.match.any, job1.jobID)).to.be.true;

      expect(loggerInfoStub.calledWith(`Resetting user-work counts for job ${job1.jobID}`)).to.be.true;
    });

    it('should not reset jobs with recent last_worked date', async () => {
      const currentDate = new Date();
      const job1 = buildJob({});
      await job1.save(db);
      const userWork4 = createUserWorkRecord({ job_id: job1.jobID, ready_count: 2, running_count: 1, last_worked: currentDate });
      await userWork4.save(db);

      await updateUserWorkMod.updateUserWork(ctx);

      // Should not have called recalculateCounts for job4
      expect(recalculateCountsStub.neverCalledWith(sinon.match.any, job1.jobID)).to.be.true;
      expect(loggerInfoStub.neverCalledWith(`Resetting user-work counts for job ${job1.jobID}`)).to.be.true;
    });

    it('should handle jobs with zero counts but still check last_worked date', async () => {
      // Insert test data - job with zero counts but old last_worked date
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 2);
      const job1 = buildJob({});
      await job1.save(db);
      const userWork5 = createUserWorkRecord({ job_id: job1.jobID, ready_count: 0, running_count: 0, last_worked: pastDate });
      await userWork5.save(db);

      await updateUserWorkMod.updateUserWork(ctx);

      // Should not have called recalculateCounts for jobs with zero counts
      expect(recalculateCountsStub.neverCalledWith(sinon.match.any, job1.jobID)).to.be.true;
      expect(loggerInfoStub.neverCalledWith(`Resetting user-work counts for job ${job1.jobID}`)).to.be.true;
    });

    it('should handle multiple rows per job_id but only process each job_id once', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 2);

      const job1 = buildJob({});
      await job1.save(db);

      // Insert test data - multiple rows for the same job_id
      const userWork6 = createUserWorkRecord({ job_id: job1.jobID, service_id: 'foo', ready_count: 1, running_count: 0, last_worked: pastDate });
      await userWork6.save(db);
      const userWork7 = createUserWorkRecord({ job_id: job1.jobID, service_id: 'bar', ready_count: 2, running_count: 0, last_worked: pastDate });
      await userWork7.save(db);

      await updateUserWorkMod.updateUserWork(ctx);

      // Should have called recalculateCounts for job6 only once for each status
      expect(recalculateCountsStub.callCount).to.equal(1);
      expect(recalculateCountsStub.calledWith(sinon.match.any, job1.jobID)).to.be.true;

      expect(loggerInfoStub.calledOnceWith(`Resetting user-work counts for job ${job1.jobID}`)).to.be.true;
    });

    it('should set set the ready count and the running count for paused jobs to zero', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 2);

      const job1 = buildJob({ status: JobStatus.PAUSED });
      await job1.save(db);

      // Insert test data - multiple rows for the same job_id
      const userWork8 = createUserWorkRecord({ job_id: job1.jobID, service_id: 'foo', ready_count: 1, running_count: 5, last_worked: pastDate });
      await userWork8.save(db);

      await updateUserWorkMod.updateUserWork(ctx);

      // Should have called setReadyAndRunningCountToZero once for job6 and recalculateCounts not at all
      expect(setReadyAndRunningCountToZeroStub.callCount).to.equal(1);
      expect(setReadyAndRunningCountToZeroStub.calledWith(sinon.match.any, job1.jobID)).to.be.true;
      expect(recalculateCountsStub.callCount).to.equal(0);

      expect(loggerInfoStub.calledOnceWith(`Resetting user-work counts for job ${job1.jobID}`)).to.be.true;
    });
  });
});