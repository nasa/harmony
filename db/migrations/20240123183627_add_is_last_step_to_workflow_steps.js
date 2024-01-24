exports.up = async function(knex) {
  return knex.schema.alterTable('workflow_steps', (t) => {
    t.boolean('is_last_step').defaultTo(false).notNullable();
  });
}

exports.down = async function(knex) {
  await knex.schema.alterTable('workflow_steps', (t) => {
    t.dropColumn('is_last_step');
  });
}