const { onUpdateTrigger } = require('../knexfile');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('service_deployment', (t) => {
    t.boolean('enabled').notNullable();
    t.timestamp('updatedAt').notNullable();
  }).raw('INSERT INTO service_deployment (enabled, "updatedAt") VALUES (true, now())')
  .then(() => knex.raw(onUpdateTrigger('service_deployment')));

};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.raw('DROP TRIGGER IF EXISTS service_deployment_updated_at ON service_deployment')
  .then(() => knex.schema.dropTable('service_deployment'));
};
