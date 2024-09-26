/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('jobs_labels', (t) => {
    t.increments('id')
      .primary();

    t.uuid('job_id')
      .notNullable()
      .references('jobID')
      .inTable('jobs')
      .onDelete('CASCADE');

    t.integer('label_id')
      .notNullable()
      .references('id')
      .inTable('labels');

    t.timestamp('createdAt')
      .notNullable();

    t.timestamp('updatedAt')
      .notNullable();

    t.index(['job_id']);
    t.index(['label_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTable('jobs_labels');
};
