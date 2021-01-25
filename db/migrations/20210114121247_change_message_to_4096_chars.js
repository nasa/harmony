/* eslint-disable arrow-body-style */

exports.up = function up(knex) {
  return knex.schema
    .alterTable('jobs', (t) => {
      t.renameColumn('message', 'message_orig');
    })
    .then(() => {
      return knex.schema
        .alterTable('jobs', (t) => {
          t.string('message', 4096).default('unknown').notNullable();
        });
    })
    .then(() => {
      return knex('jobs').update({ message: knex.raw('??', ['message_orig']) });
    })
    .then(() => {
      return knex.schema.alterTable('jobs', (t) => {
        t.dropColumn('message_orig');
      });
    });
};

exports.down = function down(knex) {
  return knex.schema
    .alterTable('jobs', (t) => {
      t.renameColumn('message', 'message_new');
    })
    .then(() => {
      return knex.schema
        .alterTable('jobs', (t) => {
          t.string('message').default('unknown').notNullable();
        });
    })
    .then(() => {
      return knex('jobs').update({ message: knex.raw('??', ['message_new']) });
    })
    .then(() => {
      return knex.schema.alterTable('jobs', (t) => {
        t.dropColumn('message_new');
      });
    });
};