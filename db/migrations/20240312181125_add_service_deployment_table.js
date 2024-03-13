/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('service_deployment', (t) => {
    t.boolean('enabled').notNullable();
    t.timestamp('updated_at').notNullable();
  }).raw('INSERT INTO service_deployment (enabled, updated_at) VALUES (true, now())');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('service_deployment');
};
