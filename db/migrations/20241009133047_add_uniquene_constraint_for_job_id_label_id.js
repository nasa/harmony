/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('jobs_labels', function (table) {
    // Adding a composite unique constraint on job_id and label_id
    table.unique(['job_id', 'label_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('jobs_labels', function (table) {
    // Dropping the unique constraint if rolled back
    table.dropUnique(['job_id', 'label_id']);
  });
};
