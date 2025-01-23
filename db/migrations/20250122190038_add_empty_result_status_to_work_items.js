/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex, Promise) {
  return knex.schema.raw(`
    ALTER TABLE "work_items"
    DROP CONSTRAINT "work_items_status_check",
    ADD CONSTRAINT "work_items_status_check"
    CHECK (status IN ('ready', 'queued', 'running', 'successful', 'failed', 'canceled', 'no-data'))
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(`
    ALTER TABLE "work_items"
    DROP CONSTRAINT "work_items_status_check",
    ADD CONSTRAINT "work_items_status_check"
    CHECK (status IN ('ready', 'queued', 'running', 'successful', 'failed', 'canceled'))
  `);
};