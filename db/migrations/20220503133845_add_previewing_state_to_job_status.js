
exports.up = function(knex, Promise) {
  return knex.schema.raw(`
    ALTER TABLE "jobs"
    DROP CONSTRAINT "jobs_status_check",
    ADD CONSTRAINT "jobs_status_check"
    CHECK (status IN ('accepted', 'running', 'successful', 'failed', 'canceled', 'paused', 'previewing'))
  `);
};

exports.down = function(knex) {
  return knex.schema.raw(`
    ALTER TABLE "jobs"
    DROP CONSTRAINT "jobs_status_check",
    ADD CONSTRAINT "jobs_status_check"
    CHECK (status IN ('accepted', 'running', 'successful', 'failed', 'canceled', 'paused'))
  `);
};