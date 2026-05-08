import { expect } from 'chai';

import { WorkItemStatus } from '../../../harmony/app/models/work-item-interface';
import { getWorkItemsStatsSummary, upsertWorkItemStats } from '../../../harmony/app/models/work-items-stats';
import db, { Transaction } from '../../../harmony/app/util/db';
import { truncateAll } from '../helpers/db';
import {
  rawSaveWorkItem,
  makePartialWorkItemRecord,
} from '../helpers/work-items';

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


describe('upsertWorkItemStats (integration)', function () {
  afterEach(async function () {
    await truncateAll();
  });

  describe('when the watermark row is missing', function () {
    it('throws with a descriptive error message', async function () {
      await db.transaction(async (tx) => {
        // Ensure no watermark row exists
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
        const pastDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
        await setWatermark(tx, pastDate);

        // Work item updated BEFORE the watermark window — should be excluded
        const oldDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord([
            'job-1',
            'service-a',
            WorkItemStatus.SUCCESSFUL,
            oldDate,
          ]),
        );

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
        const watermarkDate = new Date(Date.now() - 5 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();

        // Two distinct (minute, service, status) combos → expect 2 rows
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-1', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
        );
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-2', 'service-b', WorkItemStatus.FAILED, recentDate]),
        );

        const written = await upsertWorkItemStats(tx);

        expect(written).to.equal(2);
      });
    });

    it('aggregates multiple items with the same (minute, service, status) into one row', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date(Date.now() - 5 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();

        // Three items sharing the same group key
        for (let i = 0; i < 3; i++) {
          await rawSaveWorkItem(tx,
            makePartialWorkItemRecord(['job-' + i, 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
          );
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
        const watermarkDate = new Date(Date.now() - 5 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();

        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-1', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
        );
        // READY is not a terminal status — should be excluded
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-2', 'service-a', WorkItemStatus.READY, recentDate]),
        );

        await upsertWorkItemStats(tx);

        const stats = await readStats(tx);
        expect(stats).to.have.length(1);
        expect(stats[0].status).to.equal(WorkItemStatus.SUCCESSFUL);
      });
    });
  });

  describe('upsert conflict resolution', function () {
    it('merges the count when the same (minute, service, status) row already exists', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date(Date.now() - 5 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();

        // First pass: 2 items
        for (let i = 0; i < 2; i++) {
          await rawSaveWorkItem(tx,
            makePartialWorkItemRecord(['job-a-' + i, 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
          );
        }
        await upsertWorkItemStats(tx);

        // Reset watermark so the second pass re-processes the same window
        await setWatermark(tx, watermarkDate);

        // Add one more item in the same group
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-a-2', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
        );
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

describe('getWorkItemsStatsSummary (integration)', function () {
  afterEach(async function () {
    await truncateAll();
  });

  describe('when there are no stats rows', function () {
    it('returns empty rows with correct start/end range', async function () {
      await db.transaction(async (tx) => {
        const summary = await getWorkItemsStatsSummary(tx, 5);

        expect(summary.rows).to.have.length(0);
        expect(summary.end.getTime() - summary.start.getTime()).to.equal(5 * 60 * 1000);
      });
    });
  });

  describe('when there are stats rows within the window', function () {
    it('returns aggregated counts grouped by service and status', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date(Date.now() - 10 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-1', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
        );
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-2', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
        );
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-3', 'service-b', WorkItemStatus.FAILED, recentDate]),
        );
        await upsertWorkItemStats(tx);

        const summary = await getWorkItemsStatsSummary(tx, 5);

        expect(summary.rows).to.have.length(2);

        const serviceARow = summary.rows.find(
          (r) => r.service_id === 'service-a' && r.status === WorkItemStatus.SUCCESSFUL,
        );
        const serviceBRow = summary.rows.find(
          (r) => r.service_id === 'service-b' && r.status === WorkItemStatus.FAILED,
        );

        expect(serviceARow).to.exist;
        expect(serviceARow.count).to.equal(2);
        expect(serviceBRow).to.exist;
        expect(serviceBRow.count).to.equal(1);
      });
    });

    it('excludes stats rows outside the time window', async function () {
      await db.transaction(async (tx) => {
        // Manually insert a stats row with a minute far in the past
        await tx('work_items_stats').insert({
          minute: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          service_id: 'service-a',
          status: WorkItemStatus.SUCCESSFUL,
          count: 10,
        });

        const summary = await getWorkItemsStatsSummary(tx, 5);

        expect(summary.rows).to.have.length(0);
      });
    });
  });

  describe('includePartialCurrentMinute', function () {
    it('excludes the current in-progress minute by default', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date(Date.now() - 10 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-1', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
        );
        await upsertWorkItemStats(tx);

        // Without includePartialCurrentMinute, the current minute is excluded
        const summary = await getWorkItemsStatsSummary(tx, 5, false);

        expect(summary.rows).to.have.length(0);
      });
    });

    it('includes the current in-progress minute when flag is true', async function () {
      await db.transaction(async (tx) => {
        const watermarkDate = new Date(Date.now() - 10 * 60 * 1000);
        await setWatermark(tx, watermarkDate);

        const recentDate = new Date();
        await rawSaveWorkItem(tx,
          makePartialWorkItemRecord(['job-1', 'service-a', WorkItemStatus.SUCCESSFUL, recentDate]),
        );
        await upsertWorkItemStats(tx);

        const summary = await getWorkItemsStatsSummary(tx, 5, true);

        expect(summary.rows).to.have.length(1);
        expect(summary.rows[0].service_id).to.equal('service-a');
        expect(summary.rows[0].count).to.equal(1);
      });
    });

    it('sets end to the start of the next minute when includePartialCurrentMinute is true', async function () {
      await db.transaction(async (tx) => {
        const summary = await getWorkItemsStatsSummary(tx, 5, true);

        expect(summary.end.getTime() - summary.start.getTime()).to.equal(6 * 60 * 1000);
      });
    });
  });
});
