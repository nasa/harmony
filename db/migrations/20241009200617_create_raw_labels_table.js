/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('raw_labels', (t) => {
      t.increments('id')
        .primary();
      t.string('value', 255).notNullable();
      t.timestamp('createdAt').notNullable();
      t.timestamp('updatedAt').notNullable();
      t.unique(['value']);
      t.index(['value']);
    }).raw(`
      ALTER TABLE "raw_labels"
      ADD CONSTRAINT "lower_case_value"
      CHECK (value = lower(value))
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('raw_labels');
};
