const pgvector = require('pgvector/knex');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('umm_embeddings', (t) => {
    t.increments('id')
      .primary();

    t.string('collection_id')
      .notNullable();

    t.string('collection_name')
      .notNullable();

    t.string('variable_id')
      .notNullable();

    t.string('variable_name')
      .notNullable();

    t.text('variable_definition')
      .notNullable();

    t.vector('embedding', 1536);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('umm_embeddings');
};
