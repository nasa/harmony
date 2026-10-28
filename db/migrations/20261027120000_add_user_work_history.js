// user_work rows are deleted as soon as a job's step (or the job) finishes, or when the job is
// paused, so each row's duration totals are moved into user_work_history first (see
// moveUserWorkRowsToHistory in services/harmony/app/models/user-work-history.ts). That keeps
// user_work small for the fair queueing queries, which read every row for a service.
exports.up = async function up(knex) {
  // id and "updatedAt" (with the "updatedAt", id index) are required for the analytics cron to
  // propagate the table to Iceberg. There is deliberately no foreign key to jobs, so inserting a
  // row doesn't need to check jobs and rows don't constrain how jobs are deleted.
  await knex.schema.createTable('user_work_history', (t) => {
    t.bigIncrements('id').primary();
    t.uuid('job_id').notNullable();
    t.string('service_id', 255).notNullable();
    t.string('username', 255).notNullable();
    t.boolean('is_async');
    t.integer('completed_count').notNullable().defaultTo(0);
    t.bigInteger('sum_duration_ms').notNullable().defaultTo(0);
    t.integer('failed_count').notNullable().defaultTo(0);
    t.bigInteger('failed_sum_duration_ms').notNullable().defaultTo(0);
    t.timestamp('first_worked_at');
    t.timestamp('retired_at').notNullable();
    t.timestamp('createdAt').notNullable();
    t.timestamp('updatedAt').notNullable();
    t.unique(['job_id', 'service_id']);
    t.index(['username', 'service_id', 'retired_at']);
    t.index(['retired_at']);
    t.index(['updatedAt', 'id']);
  });

  // Adding the user_work columns needs an ACCESS EXCLUSIVE lock, held until the migration's
  // transaction commits - so these changes come last. Waiting for that lock behind a long running
  // transaction on user_work would block every scheduler and work updater query queued after it,
  // so fail the migration instead, so it can be retried.
  await knex.raw('SET LOCAL lock_timeout = \'10s\'');

  await knex.schema.alterTable('user_work', (t) => {
    t.integer('failed_count').notNullable().defaultTo(0);
    t.bigInteger('failed_sum_duration_ms').notNullable().defaultTo(0);
  });

  // user_work is a small table with a very high update rate, so autovacuum should run far more
  // often than the defaults (20% of the table dead) to keep its dead row bloat, and so the
  // scheduling queries that scan it, small. The fillfactor leaves free space on every page so
  // the hot path updates (ready_count, running_count, last_worked, average_duration,
  // completed_count, failed_count, failed_sum_duration_ms) can be HOT updates, which don't touch
  // the indexes. That only holds while none of those columns are indexed - adding an index on any
  // of them disables HOT updates for every update that changes it. Setting these only takes a
  // SHARE UPDATE EXCLUSIVE lock, which doesn't block reads or writes.
  await knex.raw(`
    ALTER TABLE user_work SET (
      autovacuum_vacuum_scale_factor = 0.02,
      autovacuum_vacuum_threshold = 1000,
      autovacuum_analyze_scale_factor = 0.05,
      fillfactor = 80
    )
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('user_work_history');
  await knex.raw(`
    ALTER TABLE user_work RESET (
      autovacuum_vacuum_scale_factor,
      autovacuum_vacuum_threshold,
      autovacuum_analyze_scale_factor,
      fillfactor
    )
  `);
  await knex.schema.alterTable('user_work', (t) => {
    t.dropColumn('failed_count');
    t.dropColumn('failed_sum_duration_ms');
  });
};
