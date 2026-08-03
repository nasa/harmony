exports.up = function (knex) {
  return knex.schema.alterTable('workflow_steps', (table) => {
    table.bigInteger('maxBatchSizeInBytes').alter();
  });
}

exports.down = function (knex) {
  return knex.schema.alterTable('workflow_steps', (table) => {
    table.integer('maxBatchSizeInBytes').alter();
  });
}