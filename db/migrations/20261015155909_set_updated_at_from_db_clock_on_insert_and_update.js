// Changes how "updatedAt" is set on the tables that use the on_update_timestamp() trigger:
//
// 1. Use clock_timestamp() instead of now(). now() is the time the transaction *started*, so
//    a row written by a long-running transaction gets an "updatedAt" well before it becomes
//    visible to other sessions. The analytics cron job pages through rows by "updatedAt" with
//    only a short overlap, so such rows could be skipped. clock_timestamp() is the time the
//    row is actually written, which narrows the gap to the time between the write and the
//    commit.
// 2. Also set "updatedAt" on INSERT. Previously only updates were stamped by the database;
//    inserted rows kept whatever the writing process sent (e.g. `new Date()` on its own
//    clock), so a table's timestamps came from a mix of clocks.
//
// The labels tables (raw_labels, jobs_raw_labels, users_labels) have no update trigger and
// are not included here. The function change also applies to service_deployment's existing
// update trigger.
const TABLES = [
  'batch_items', 'batches', 'job_links', 'job_messages', 'jobs', 'service_deployments',
  'work_items', 'workflow_steps',
];

const triggerName = (table) => `${table}_inserted_updated_at`;

const setTimestampFunction = (timestamp) => `
  CREATE OR REPLACE FUNCTION on_update_timestamp()
  RETURNS trigger AS $$
  BEGIN
    NEW."updatedAt" = ${timestamp};
    RETURN NEW;
  END;
$$ language 'plpgsql';
`;

exports.up = async function (knex) {
  await knex.raw(setTimestampFunction('clock_timestamp()'));
  for (const table of TABLES) {
    // on_update_timestamp() only sets NEW."updatedAt", so it works for inserts too
    await knex.raw(`
      CREATE TRIGGER ${triggerName(table)}
      BEFORE INSERT ON ${table}
      FOR EACH ROW
      EXECUTE PROCEDURE on_update_timestamp();
    `);
  }
};

exports.down = async function (knex) {
  for (const table of TABLES) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${triggerName(table)} ON ${table}`);
  }
  await knex.raw(setTimestampFunction('now()'));
};
