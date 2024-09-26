/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('labels', (t) => {
    t.increments('id')
      .primary();

    t.uuid('job_id')
      .notNullable()
      .references('jobID')
      .inTable('jobs')
      .onDelete('CASCADE');

    t.integer('user_label_id', 255)
      .notNullable()
      .references('id')
      .inTable('user_labels');

    t.timestamp('createdAt')
      .notNullable();

    t.timestamp('updatedAt')
      .notNullable();

    t.index(['job_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTable('labels');
};
