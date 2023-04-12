exports.up = function(knex) {
  return knex.schema.alterTable('workflow_steps', async (t) => {
    t.integer('maxBatchInputs');
    t.integer('maxBatchSizeInBytes');
    t.boolean('isBatched').defaultTo(false).notNullable();
  });  
};

exports.down = function(knex) {
  return knex.schema.alterTable('workflow_steps', async (t) => {
    t.dropColumn('maxBatchInputs');
    t.dropColumn('maxBatchSizeInBytes');
    t.dropColumn('isBatched');
  });
};