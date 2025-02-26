/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex, Promise) {
  return knex.schema.raw(`
    ALTER TABLE "work_items"
    RENAME COLUMN "sub_status" TO "message_category";
    ALTER TABLE "job_errors"
    RENAME COLUMN "category" TO "message_category";
    ALTER TABLE "job_errors"
    RENAME TO "job_messages";
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(`
    ALTER TABLE "job_messages"
    RENAME TO "job_errors";
    ALTER TABLE "job_errors"
    RENAME COLUMN "message_category" TO "category";
    ALTER TABLE "work_items"
    RENAME COLUMN "message_category" TO "sub_status";
  `);
};