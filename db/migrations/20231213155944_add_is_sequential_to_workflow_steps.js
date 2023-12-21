exports.up = function(knex) {
  return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.boolean('is_sequential').defaultTo(false).notNullable();
    });
  };

exports.down = function(knex) {
  return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.dropColumn('is_sequential');
    });
};
