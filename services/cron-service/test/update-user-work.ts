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

describe('getTimestampFromInterval', () => {
  let clock: sinon.SinonFakeTimers;
  const fixedDate = new Date('2023-04-15T12:00:00Z');
  const fixedTimestamp = fixedDate.getTime();

  beforeEach(() => {
    // Use sinon to mock the system clock
    clock = sinon.useFakeTimers(fixedTimestamp);
  });

  afterEach(() => {
    // Restore the clock after each test
    clock.restore();
  });

  describe('basic functionality', () => {
    it('should return the current timestamp when interval is zero', () => {
      expect(updateUserWorkMod.getTimestampFromInterval('+0 SECONDS')).to.equal(fixedTimestamp);
      expect(updateUserWorkMod.getTimestampFromInterval('-0 MINUTES')).to.equal(fixedTimestamp);
    });

    it('should handle positive intervals correctly', () => {
      const oneSecondLater = fixedTimestamp + 1000;
      const oneMinuteLater = fixedTimestamp + 60 * 1000;
      const oneHourLater = fixedTimestamp + 60 * 60 * 1000;
      const oneDayLater = fixedTimestamp + 24 * 60 * 60 * 1000;

      expect(updateUserWorkMod.getTimestampFromInterval('+1 SECOND')).to.equal(oneSecondLater);
      expect(updateUserWorkMod.getTimestampFromInterval('+1 MINUTE')).to.equal(oneMinuteLater);
      expect(updateUserWorkMod.getTimestampFromInterval('+1 HOUR')).to.equal(oneHourLater);
      expect(updateUserWorkMod.getTimestampFromInterval('+1 DAY')).to.equal(oneDayLater);
    });

    it('should handle negative intervals correctly', () => {
      const oneSecondAgo = fixedTimestamp - 1000;
      const oneMinuteAgo = fixedTimestamp - 60 * 1000;
      const oneHourAgo = fixedTimestamp - 60 * 60 * 1000;
      const oneDayAgo = fixedTimestamp - 24 * 60 * 60 * 1000;

      expect(updateUserWorkMod.getTimestampFromInterval('-1 SECOND')).to.equal(oneSecondAgo);
      expect(updateUserWorkMod.getTimestampFromInterval('-1 MINUTE')).to.equal(oneMinuteAgo);
      expect(updateUserWorkMod.getTimestampFromInterval('-1 HOUR')).to.equal(oneHourAgo);
      expect(updateUserWorkMod.getTimestampFromInterval('-1 DAY')).to.equal(oneDayAgo);
    });
  });

  describe('unit variations', () => {
    it('should handle singular and plural units', () => {
      const tenMinutes = 10 * 60 * 1000;

      expect(updateUserWorkMod.getTimestampFromInterval('+10 MINUTE')).to.equal(fixedTimestamp + tenMinutes);
      expect(updateUserWorkMod.getTimestampFromInterval('+10 MINUTES')).to.equal(fixedTimestamp + tenMinutes);
    });

    it('should be case-insensitive for units', () => {
      const twoHours = 2 * 60 * 60 * 1000;

      expect(updateUserWorkMod.getTimestampFromInterval('+2 HOURS')).to.equal(fixedTimestamp + twoHours);
      expect(updateUserWorkMod.getTimestampFromInterval('+2 hours')).to.equal(fixedTimestamp + twoHours);
      expect(updateUserWorkMod.getTimestampFromInterval('+2 Hours')).to.equal(fixedTimestamp + twoHours);
    });
  });

  describe('complex intervals', () => {
    it('should handle larger interval values', () => {
      const twentyFourHours = 24 * 60 * 60 * 1000;
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      expect(updateUserWorkMod.getTimestampFromInterval('+24 HOURS')).to.equal(fixedTimestamp + twentyFourHours);
      expect(updateUserWorkMod.getTimestampFromInterval('-30 DAYS')).to.equal(fixedTimestamp - thirtyDays);
    });
  });

  describe('error handling', () => {
    it('should throw error for invalid interval format', () => {
      const invalidIntervals = [
        '',                  // Empty string
        '1 HOUR',            // Missing sign
        '+ 1 HOUR',          // Space after sign
        '+1HOUR',            // Missing space between number and unit
        '+one HOUR',         // Non-numeric value
        '+1 WEEK',           // Unsupported unit
        'HOUR 1',            // Wrong order
        '+1 H',              // Invalid unit abbreviation
        '1 HOUR AGO',         // Extra words
      ];

      invalidIntervals.forEach(interval => {
        expect(() => updateUserWorkMod.getTimestampFromInterval(interval))
          .to.throw(`Invalid interval [${interval}] format. Must be in format like "+1 HOUR", "-10 MINUTES", "+30 SECONDS"`);
      });
    });
  });

  describe('whitespace handling', () => {
    it('should handle extra whitespace in the interval string', () => {
      const fiveMinutes = 5 * 60 * 1000;

      expect(updateUserWorkMod.getTimestampFromInterval('  +5 MINUTES  ')).to.equal(fixedTimestamp + fiveMinutes);
      expect(updateUserWorkMod.getTimestampFromInterval('+5    MINUTES')).to.equal(fixedTimestamp + fiveMinutes);
    });
  });
});

describe('UserWorkUpdater', () => {
  let ctx: Context;
  let loggerInfoStub: sinon.SinonStub;
  let loggerDebugStub: sinon.SinonStub;
  let loggerErrorStub: sinon.SinonStub;
  let recalculateCountStub: sinon.SinonStub;
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

    // Set up recalculateCount stub
    recalculateCountStub = sinon.stub(userWork, 'recalculateCount').resolves();

    // Set up setReadyAndRunningCountToZero stub
    setReadyAndRunningCountToZeroStub = sinon.stub(userWork, 'setReadyAndRunningCountToZero').resolves();

    // Set environment variables
    env.userWorkUpdateAge = '1 hour';
  });

  afterEach(() => {
    setReadyAndRunningCountToZeroStub.reset();
    recalculateCountStub.reset();
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

      // Should have called recalculateCount for job1 only
      expect(recalculateCountStub.callCount).to.equal(2); // Once for ready, once for running
      expect(recalculateCountStub.firstCall.args[1]).to.equal(job1.jobID);
      expect(recalculateCountStub.firstCall.args[2]).to.equal('ready');
      expect(recalculateCountStub.secondCall.args[1]).to.equal(job1.jobID);
      expect(recalculateCountStub.secondCall.args[2]).to.equal('running');

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

      // Should have called recalculateCount for job3
      expect(recalculateCountStub.callCount).to.equal(2);
      expect(recalculateCountStub.calledWith(sinon.match.any, job1.jobID, 'ready')).to.be.true;
      expect(recalculateCountStub.calledWith(sinon.match.any, job1.jobID, 'running')).to.be.true;

      expect(loggerInfoStub.calledWith(`Resetting user-work counts for job ${job1.jobID}`)).to.be.true;
    });

    it('should not reset jobs with recent last_worked date', async () => {
      const currentDate = new Date();
      const job1 = buildJob({});
      await job1.save(db);
      const userWork4 = createUserWorkRecord({ job_id: job1.jobID, ready_count: 2, running_count: 1, last_worked: currentDate });
      await userWork4.save(db);

      await updateUserWorkMod.updateUserWork(ctx);

      // Should not have called recalculateCount for job4
      expect(recalculateCountStub.neverCalledWith(sinon.match.any, job1.jobID, sinon.match.any)).to.be.true;
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

      // Should not have called recalculateCount for jobs with zero counts
      expect(recalculateCountStub.neverCalledWith(sinon.match.any, job1.jobID, sinon.match.any)).to.be.true;
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

      // Should have called recalculateCount for job6 only once for each status
      expect(recalculateCountStub.callCount).to.equal(2);
      expect(recalculateCountStub.calledWith(sinon.match.any, job1.jobID, 'ready')).to.be.true;
      expect(recalculateCountStub.calledWith(sinon.match.any, job1.jobID, 'running')).to.be.true;

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

      // Should have called setReadyAndRunningCountToZero once for job6 and recalculateCount not at all
      expect(setReadyAndRunningCountToZeroStub.callCount).to.equal(1);
      expect(setReadyAndRunningCountToZeroStub.calledWith(sinon.match.any, job1.jobID)).to.be.true;
      expect(recalculateCountStub.callCount).to.equal(0);

      expect(loggerInfoStub.calledOnceWith(`Resetting user-work counts for job ${job1.jobID}`)).to.be.true;
    });
  });
});