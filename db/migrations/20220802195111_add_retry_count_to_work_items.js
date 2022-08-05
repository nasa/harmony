
exports.up = function(knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.integer('retryCount').defaultTo(0);
  });  
};

exports.down = function(knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.dropColumn('retryCount');
  });
};
