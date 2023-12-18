exports.up = function(knex) {
  return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.boolean('is_complete').defaultTo(false).notNullable();
    });
  };

exports.down = function(knex) {
  return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.dropColumn('is_complete');
    });
};
 
