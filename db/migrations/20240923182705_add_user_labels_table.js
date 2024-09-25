/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('user_labels', (t) => {
      t.increments('id').primary();
      t.string('username', 255).notNullable();
      t.string('value', 255).notNullable();
      t.timestamp('createdAt').notNullable();
      t.timestamp('updatedAt').notNullable();
      t.unique(['username', 'value']);
      t.index(['username']);
    }).raw(`
      ALTER TABLE "user_labels"
      ADD CONSTRAINT "lower_case_value"
      CHECK (value = lower(value))
    `);
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTable('user_labels');
};
