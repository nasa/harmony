const { onUpdateTrigger } = require('../knexfile');

exports.up = function up(knex) {
  return knex.schema.createTable('service_deployments', (t) => {
    t.increments('id')
      .primary();

    t.uuid('deployment_id')
      .notNullable();

    t.string('username')
      .notNullable();

    t.string('service')
      .notNullable();

    t.string('tag')
      .notNullable();

    t.enu('status', ['running', 'successful', 'failed'])
      .notNullable();

    t.string('message', 4096);

    t.timestamp('createdAt')
      .notNullable();

    t.timestamp('updatedAt')
      .notNullable();

    t.index(['deployment_id']);
    t.index(['username']);
  })
  .then(() => knex.raw(onUpdateTrigger('service_deployments')));
};

exports.down = function down(knex) {
  return knex.schema.dropTable('service_deployments');
};
