import { expect } from 'chai';
import { subDays } from 'date-fns';
import sinon from 'sinon';

import { buildJob } from './helpers/jobs';
import { truncateAll } from '../../../packages/util/test/helpers/db';
import { Job, JobStatus } from '../../harmony/app/models/job';
import UserWorkHistory from '../../harmony/app/models/user-work-history';
import db from '../../harmony/app/util/db';
import {
  deleteExpiredUserWorkHistory, UserWorkHistoryReaper,
} from '../app/cronjobs/user-work-history-reaper';
import { Context } from '../app/util/context';
import env from '../app/util/env';

/**
 * Inserts a user_work_history row for a job
 *
 * @param jobID - The job ID
 * @param serviceID - The service ID
 * @param retiredAt - When the row was last written
 * @returns a promise that resolves once the row is inserted
 */
async function insertHistory(jobID: string, serviceID: string, retiredAt: Date): Promise<void> {
  await db(UserWorkHistory.table).insert({
    job_id: jobID, service_id: serviceID, username: 'joe', is_async: true, completed_count: 1,
    sum_duration_ms: 100, failed_count: 0, failed_sum_duration_ms: 0, first_worked_at: retiredAt,
    retired_at: retiredAt, createdAt: retiredAt, updatedAt: retiredAt,
  });
}

describe('UserWorkHistoryReaper', function () {
  let ctx: Context;
  let originalBatchSize: number;
  let originalRetentionDays: number;
  const old = subDays(new Date(), 60);
  let finishedJob: Job;
  let pausedJob: Job;

  beforeEach(async function () {
    await truncateAll();
    ctx = {
      logger: { info: sinon.stub(), error: sinon.stub(), warn: sinon.stub() },
      db,
    } as unknown as Context;
    originalBatchSize = env.userWorkHistoryReaperBatchSize;
    originalRetentionDays = env.userWorkHistoryRetentionDays;
    // smaller than the number of expired rows, so several batches are needed
    env.userWorkHistoryReaperBatchSize = 2;
    env.userWorkHistoryRetentionDays = 30;

    finishedJob = buildJob({ status: JobStatus.SUCCESSFUL });
    await finishedJob.save(db);
    pausedJob = buildJob({ status: JobStatus.PAUSED });
    await pausedJob.save(db);
    for (const serviceID of ['svc1', 'svc2', 'svc3', 'svc4', 'svc5']) {
      await insertHistory(finishedJob.jobID, serviceID, old);
    }
    await insertHistory(finishedJob.jobID, 'recent', new Date());
    await insertHistory(pausedJob.jobID, 'svc1', old);
  });

  afterEach(async function () {
    env.userWorkHistoryReaperBatchSize = originalBatchSize;
    env.userWorkHistoryRetentionDays = originalRetentionDays;
    sinon.restore();
    await truncateAll();
  });

  it('deletes every expired row for finished jobs across multiple batches', async function () {
    const numDeleted = await deleteExpiredUserWorkHistory(ctx, subDays(new Date(), 30));
    expect(numDeleted).to.equal(5);
  });

  it('keeps recent rows and rows for jobs that are not finished', async function () {
    await UserWorkHistoryReaper.run(ctx);
    const remaining = (await db(UserWorkHistory.table).orderBy('id'))
      .map((r) => `${r.job_id}:${r.service_id}`);
    expect(remaining).to.eql([`${finishedJob.jobID}:recent`, `${pausedJob.jobID}:svc1`]);
  });

  it('logs and does not throw if the deletion fails', async function () {
    const failingCtx = { ...ctx, db: undefined } as unknown as Context;
    await UserWorkHistoryReaper.run(failingCtx);
    expect((ctx.logger.error as sinon.SinonStub).calledWith('User work history reaper failed to delete expired rows')).to.be.true;
  });
});
