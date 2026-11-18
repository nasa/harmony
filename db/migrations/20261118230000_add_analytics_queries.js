// Saved queries for the /admin/analytics page (see services/harmony/app/models/analytics-query.ts).
// The queries themselves run against the Iceberg analytics tables, not this database - this table
// only holds their text. It is deliberately not one of the tables the analytics cron copies to
// Iceberg.
exports.up = async function up(knex) {
  await knex.schema.createTable('analytics_queries', (t) => {
    t.bigIncrements('id').primary();
    t.string('name', 255).notNullable();
    t.text('description');
    t.text('sql').notNullable();
    // JSON: default values for the query's parameters, by parameter name
    t.text('parameters');
    // JSON: how to chart the query's results, for when charts are added
    t.text('chart');
    // The user who saved it, the only one (with admins) who can change or delete it
    t.string('username', 255).notNullable();
    t.timestamp('createdAt').notNullable();
    t.timestamp('updatedAt').notNullable();
    t.unique(['username', 'name']);
    t.index(['updatedAt']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('analytics_queries');
};
