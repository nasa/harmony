import { expect } from 'chai';

import { truncateAll } from './helpers/db';
import { rawSaveWorkItem } from './helpers/work-items';
import { WorkItemStatus } from '../../harmony/app/models/work-item-interface';
import { upsertWorkItemStats } from '../../harmony/app/models/work-items-stats';
import db, { Transaction } from '../../harmony/app/util/db';


/**
 * Insert or reset the watermark row used by upsertWorkItemStats
 *
 * @param trx - the transaction to use
 * @param lastRunAt - the watermark timestamp to set
 */
async function setWatermark(trx: Transaction, lastRunAt: Date): Promise<void> {
  const exists = await trx('run_watermarks')
    .where({ name: 'work_item_stats_update' })
    .first();

  if (exists) {
    await trx('run_watermarks')
      .where({ name: 'work_item_stats_update' })
      .update({ last_run_at: lastRunAt });
  } else {
    await trx('run_watermarks').insert({
      name: 'work_item_stats_update',
      last_run_at: lastRunAt,
    });
  }
}

/**
 * Read all rows from work_items_stats via the given transaction
 *
 * @param trx - the transaction to use
 * @returns all rows from work_items_stats
 */
async function readStats(
  trx: Transaction,
): Promise<{ minute: Date; service_id: string; status: string; count: number }[]> {
  return trx('work_items_stats').select('*');
}

/**
 * Save a work item with an explicit updatedAt, bypassing any timestamp overrides.
 * This ensures the item falls within the expected watermark window.
 *
 * @param trx - the transaction to use
 * @param jobID - the job ID to associate with the work item
 * @param serviceID - the service ID to associate with the work item
 * @param status - the status of the work item
 * @param updatedAt - the timestamp to use for both createdAt and updatedAt
 */
async function saveWorkItemWithTimestamp(
  trx: Transaction,
  jobID: string,
  serviceID: string,
  status: WorkItemStatus,
  updatedAt: Date,
): Promise<void> {
  await rawSaveWorkItem(trx, {
    jobID,
    serviceID,
    status,
    updatedAt,
    createdAt: updatedAt,
  });
}


describe('upsertWorkItemStats (integration)', function () {
  afterEach(async function () {
    await truncateAll();
  });

  describe('when the watermark row is missing', function () {
    it('throws with a descriptive error message', async function () {
      await db.transaction(async (tx) => {
        await tx('run_watermarks')
          .where({ name: 'work_item_stats_update' })
          .delete();

        await expect(upsertWorkItemStats(tx)).to.be.rejectedWith(
          'Missing watermark row for work_item_stats_update',
        );
      });
    });
  });

  describe('when there are no work items updated since the watermark', function () {
    it('returns 0 and writes nothing to work_items_stats', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date();
        await setWatermark(tx, watermarkDate);

        const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await saveWorkItemWithTimestamp(tx, 'job-1', 'service-a', WorkItemStatus.SUCCESSFUL, oldDate);

        const written = await upsertWorkItemStats(tx);

        expect(written).to.equal(0);
        const stats = await readStats(tx);
        expect(stats).to.have.length(0);
      });
    });
  });

  describe('when there are qualifying work items', function () {
    it('returns the number of rows written to work_items_stats', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date(Date.now() - 30 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();

        await saveWorkItemWithTimestamp(tx, 'job-1', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate);
        await saveWorkItemWithTimestamp(tx, 'job-2', 'service-b', WorkItemStatus.FAILED, recentDate);

        const written = await upsertWorkItemStats(tx);

        expect(written).to.equal(2);
      });
    });

    it('aggregates multiple items with the same (minute, service, status) into one row', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date(Date.now() - 30 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();

        for (let i = 0; i < 3; i++) {
          await saveWorkItemWithTimestamp(tx, `job-${i}`, 'service-a', WorkItemStatus.SUCCESSFUL, recentDate);
        }

        await upsertWorkItemStats(tx);

        const stats = await readStats(tx);

        expect(stats).to.have.length(1);
        expect(stats[0].count).to.equal(3);
        expect(stats[0].service_id).to.equal('service-a');
        expect(stats[0].status).to.equal(WorkItemStatus.SUCCESSFUL);
      });
    });

    it('only counts terminal statuses (failed, canceled, warning, successful)', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date(Date.now() - 30 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();

        await saveWorkItemWithTimestamp(tx, 'job-1', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate);
        await saveWorkItemWithTimestamp(tx, 'job-2', 'service-a', WorkItemStatus.READY, recentDate);

        await upsertWorkItemStats(tx);

        const stats = await readStats(tx);
        expect(stats).to.have.length(1);
        expect(stats[0].status).to.equal(WorkItemStatus.SUCCESSFUL);
        expect(stats[0].count).to.equal(1);
      });
    });
  });

  describe('upsert conflict resolution', function () {
    it('merges the count when the same (minute, service, status) row already exists', async function () {
      const watermarkDate = new Date(Date.now() - 30 * 60 * 1000);
      const recentDate = new Date();

      await db.transaction(async (tx) => {
        await setWatermark(tx, watermarkDate);
        for (let i = 0; i < 2; i++) {
          await saveWorkItemWithTimestamp(tx, `job-a-${i}`, 'service-a', WorkItemStatus.SUCCESSFUL, recentDate);
        }
        await upsertWorkItemStats(tx);
      });

      await db.transaction(async (tx) => {
        await setWatermark(tx, watermarkDate);
        await saveWorkItemWithTimestamp(tx, 'job-a-2', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate);
        await upsertWorkItemStats(tx);

        const stats = await readStats(tx);
        expect(stats).to.have.length(1);
        expect(stats[0].count).to.equal(3);
      });
    });
  });

  describe('watermark update', function () {
    it('advances last_run_at after a successful run', async function () {
      const beforeRun = new Date(Date.now() - 10 * 60 * 1000);

      await db.transaction(async (tx) => {
        await setWatermark(tx, beforeRun);
        await upsertWorkItemStats(tx);

        const updated = await tx('run_watermarks')
          .where({ name: 'work_item_stats_update' })
          .first('last_run_at');

        expect(new Date(updated.last_run_at).getTime()).to.be.greaterThan(
          beforeRun.getTime(),
        );
      });
    });
  });
});
