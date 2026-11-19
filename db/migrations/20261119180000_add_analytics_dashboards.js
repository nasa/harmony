// Dashboards for the /admin/analytics page (see services/harmony/app/models/analytics-dashboard.ts):
// a layout of panels, each showing a saved query (analytics_queries) as a chart or a table. Panels
// refer to saved queries by id without a foreign key, so deleting a query leaves the dashboard
// with a panel that says the query is gone, rather than failing or silently removing the panel.
// Like analytics_queries, this is not one of the tables the analytics cron copies to Iceberg.
exports.up = async function up(knex) {
  await knex.schema.createTable('analytics_dashboards', (t) => {
    t.bigIncrements('id').primary();
    t.string('name', 255).notNullable();
    t.text('description');
    // JSON: the panels, in order
    t.text('panels').notNullable();
    // JSON: values for the panels' query parameters, by parameter name
    t.text('parameters');
    // The user who saved it
    t.string('username', 255).notNullable();
    t.timestamp('createdAt').notNullable();
    t.timestamp('updatedAt').notNullable();
    t.unique(['username', 'name']);
    t.index(['updatedAt']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('analytics_dashboards');
};
