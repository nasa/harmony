// Whether a saved analytics query is shared with every user of the page, or private to its owner.
// New queries are private unless saved as shared. Queries saved before this column existed were
// visible to everyone (and may be on other users' dashboards), so they stay shared.
exports.up = async function up(knex) {
  await knex.schema.alterTable('analytics_queries', (t) => {
    t.boolean('shared').notNullable().defaultTo(false);
  });
  await knex('analytics_queries').update({ shared: true });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('analytics_queries', (t) => {
    t.dropColumn('shared');
  });
};
