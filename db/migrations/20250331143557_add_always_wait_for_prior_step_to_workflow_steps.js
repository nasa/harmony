exports.up = function(knex) {
  return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.boolean('always_wait_for_prior_step').defaultTo(false).notNullable();
    });
  };

exports.down = function(knex) {
  return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.dropColumn('always_wait_for_prior_step');
    });
};