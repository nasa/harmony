/* eslint-disable arrow-body-style */

exports.up = function up(knex) {
  return knex.schema
    .alterTable('jobs', (t) => {
      t.renameColumn('request', 'request_orig');
    })
    .then(() => {
      return knex.schema
        .alterTable('jobs', (t) => {
          t.string('request', 4096).default('unknown').notNullable();
        });
    })
    .then(() => {
      return knex('jobs').update({ request: knex.raw('??', ['request_orig']) });
    })
    .then(() => {
      return knex.schema.alterTable('jobs', (t) => {
        t.dropColumn('request_orig');
      });
    });
};

exports.down = function down(knex) {
  return knex.schema
    .alterTable('jobs', (t) => {
      t.renameColumn('request', 'request_new');
    })
    .then(() => {
      return knex.schema
        .alterTable('jobs', (t) => {
          t.string('request').default('unknown').notNullable();
        });
    })
    .then(() => {
      return knex('jobs').update({ request: knex.raw('??', ['request_new']) });
    })
    .then(() => {
      return knex.schema.alterTable('jobs', (t) => {
        t.dropColumn('request_new');
      });
    });
};
