
exports.up = function(knex) {
  return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.boolean('hasAggregatedOutput').defaultTo(false).notNullable();
    });
};

exports.down = function(knex) {
   return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.dropColumn('hasAggregatedOutput');
    });
};
