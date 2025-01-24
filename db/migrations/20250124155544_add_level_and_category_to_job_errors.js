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
    ADD COLUMN "category" VARCHAR(255) DEFAULT 'generic' NOT NULL;

    CREATE INDEX job_errors_level ON job_errors (level);
    CREATE INDEX job_errors_category ON job_errors (category)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(`
    DROP INDEX job_errors_category;
    DROP_INDEX job_errors_level;
    ALTER TABLE "job_errors"
    DROP CONSTRAINT "job_errors_category_check",
    DROP COLUMN "category",
    DROP CONSTRAINT "job_errors_level_check",
    DROP COLUMN "level"
  `);
};