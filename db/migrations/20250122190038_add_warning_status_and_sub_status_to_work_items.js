/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex, Promise) {
  return knex.schema.raw(`
    ALTER TABLE "work_items"
    DROP CONSTRAINT "work_items_status_check",
    ADD CONSTRAINT "work_items_status_check"
    CHECK (status IN ('ready', 'queued', 'running', 'successful', 'failed', 'canceled', 'warning')),
    ADD COLUMN "sub_status" VARCHAR(255);

    CREATE INDEX work_items_sub_status ON work_items (sub_status);
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(`
    DROP_INDEX work_items_sub_status;
    ALTER TABLE "work_items"
    DROP COLUMN "sub_status"),
    DROP CONSTRAINT "work_items_status_check",
    ADD CONSTRAINT "work_items_status_check"
    CHECK (status IN ('ready', 'queued', 'running', 'successful', 'failed', 'canceled'))
  `);
};