// The row limit a saved analytics query runs with: set on the Query tab when the query is saved, and
// used by dashboard panels showing the query unless a panel sets its own. Null for queries saved
// before this column existed, which run with the default.
exports.up = async function up(knex) {
  await knex.schema.alterTable('analytics_queries', (t) => {
    t.integer('row_limit');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('analytics_queries', (t) => {
    t.dropColumn('row_limit');
  });
};
