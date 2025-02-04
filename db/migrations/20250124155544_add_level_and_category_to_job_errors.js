/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex, Promise) {
  return knex.schema.raw(`
    ALTER TABLE "job_errors"
    ADD COLUMN "level" VARCHAR(255) DEFAULT 'error' NOT NULL,
    ADD CONSTRAINT "job_errors_level_check"
    CHECK (level IN ('error', 'warning')),
    ADD COLUMN "category" VARCHAR(255);

    CREATE INDEX job_errors_level_index ON job_errors (level);
    CREATE INDEX job_errors_category_index ON job_errors (category);
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(`
    DROP INDEX job_errors_category_index;
    DROP INDEX job_errors_level_index;
    ALTER TABLE "job_errors"
    DROP COLUMN "category",
    DROP CONSTRAINT "job_errors_level_check",
    DROP COLUMN "level";
  `);
};