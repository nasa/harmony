/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .table('job_links', function (table) {
      table.index(['jobID', 'id']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .table('job_links', function (table) {
      table.dropIndex(['jobID', 'id']);
    });
};
