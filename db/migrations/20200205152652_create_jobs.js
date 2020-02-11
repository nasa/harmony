
exports.up = function up(knex) {
  return knex.schema.createTable('jobs', (t) => {
    t.increments('id')
      .primary();

    t.uuid('requestId')
      .notNullable();

    t.string('username')
      .notNullable();

    t.enu('status', ['accepted', 'running', 'successful', 'failed'])
      .notNullable();

    t.string('message')
      .notNullable();

    t.integer('progress')
      .notNullable();

    t.json('_json_links')
      .notNullable();

    t.timestamp('createdAt')
      .notNullable();

    t.timestamp('updatedAt')
      .notNullable();

    t.index(['id', 'username', 'requestId']);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTable('jobs');
};
