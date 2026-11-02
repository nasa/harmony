// Aggregate tables for the admin dashboard, populated by the cron service's work items stats job
// (see services/harmony/app/models/work-items-stats.ts) so the dashboard never has to query
// work_items or jobs directly. Each per-minute table has an hourly rollup, which is what the
// dashboard reads for longer time ranges and which is kept for much longer.

// The number of work item duration histogram buckets (see DURATION_BUCKET_UPPER_BOUNDS_MS)
const NUM_DURATION_BUCKETS = 8;

/**
 * Adds the work item metric columns shared by the service and user level tables
 * @param t - the knex table builder
 */
function addWorkItemMetricColumns(t) {
  t.bigInteger('duration_count').notNullable().defaultTo(0);
  t.bigInteger('sum_duration_ms').notNullable().defaultTo(0);
  t.bigInteger('max_duration_ms').notNullable().defaultTo(0);
  t.bigInteger('retry_count').notNullable().defaultTo(0);
  t.double('sum_items_size').notNullable().defaultTo(0);
}

/**
 * Adds the work item duration histogram bucket columns
 * @param t - the knex table builder
 */
function addDurationBucketColumns(t) {
  for (let i = 0; i < NUM_DURATION_BUCKETS; i++) {
    t.bigInteger(`duration_bucket_${i}`).notNullable().defaultTo(0);
  }
}

exports.up = async function up(knex) {
  // the existing per-minute service level table gets durations, retries, and sizes
  await knex.schema.alterTable('work_items_stats', (t) => {
    addWorkItemMetricColumns(t);
    addDurationBucketColumns(t);
  });

  await knex.schema.createTable('work_items_stats_hourly', (t) => {
    t.timestamp('hour').notNullable();
    t.string('service_id').notNullable();
    t.string('status').notNullable();
    t.bigInteger('count').notNullable();
    addWorkItemMetricColumns(t);
    addDurationBucketColumns(t);
    t.primary(['hour', 'service_id', 'status']);
    t.index(['service_id', 'hour']);
  });

  for (const [table, timeColumn] of [['user_work_items_stats', 'minute'], ['user_work_items_stats_hourly', 'hour']]) {
    await knex.schema.createTable(table, (t) => {
      t.timestamp(timeColumn).notNullable();
      t.string('username').notNullable();
      t.string('service_id').notNullable();
      t.string('status').notNullable();
      t.bigInteger('count').notNullable();
      addWorkItemMetricColumns(t);
      t.primary([timeColumn, 'username', 'service_id', 'status']);
      t.index(['username', timeColumn]);
      t.index(['service_id', timeColumn]);
    });
  }

  for (const [table, timeColumn] of [['work_items_failure_stats', 'minute'], ['work_items_failure_stats_hourly', 'hour']]) {
    await knex.schema.createTable(table, (t) => {
      t.timestamp(timeColumn).notNullable();
      t.string('service_id').notNullable();
      t.string('status').notNullable();
      // '' when the work item has no message category
      t.string('message_category').notNullable();
      t.bigInteger('count').notNullable();
      t.primary([timeColumn, 'service_id', 'status', 'message_category']);
      t.index(['service_id', timeColumn]);
    });
  }

  for (const [table, timeColumn] of [['job_stats', 'minute'], ['job_stats_hourly', 'hour']]) {
    await knex.schema.createTable(table, (t) => {
      t.timestamp(timeColumn).notNullable();
      t.string('username').notNullable();
      t.boolean('is_async').notNullable();
      t.string('status').notNullable();
      t.bigInteger('count').notNullable();
      t.bigInteger('sum_duration_ms').notNullable().defaultTo(0);
      t.bigInteger('max_duration_ms').notNullable().defaultTo(0);
      t.bigInteger('sum_granules').notNullable().defaultTo(0);
      t.double('sum_input_size').notNullable().defaultTo(0);
      t.double('sum_output_size').notNullable().defaultTo(0);
      t.primary([timeColumn, 'username', 'is_async', 'status']);
      t.index(['username', timeColumn]);
    });
  }

  // Backfill the hourly rollup from the per-minute counts collected so far. Only counts exist for
  // those minutes, so their durations are left at 0 (and excluded from duration averages, since
  // their duration_count is 0).
  await knex.raw(`
    INSERT INTO work_items_stats_hourly (hour, service_id, status, count)
    SELECT date_trunc('hour', minute), service_id, status, SUM(count)
    FROM work_items_stats
    GROUP BY 1, 2, 3
  `);
};

exports.down = async function down(knex) {
  for (const table of [
    'work_items_stats_hourly', 'user_work_items_stats', 'user_work_items_stats_hourly',
    'work_items_failure_stats', 'work_items_failure_stats_hourly', 'job_stats', 'job_stats_hourly',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.schema.alterTable('work_items_stats', (t) => {
    for (const column of ['duration_count', 'sum_duration_ms', 'max_duration_ms', 'retry_count', 'sum_items_size']) {
      t.dropColumn(column);
    }
    for (let i = 0; i < NUM_DURATION_BUCKETS; i++) {
      t.dropColumn(`duration_bucket_${i}`);
    }
  });
};
