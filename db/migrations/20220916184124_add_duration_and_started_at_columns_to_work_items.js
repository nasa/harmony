
exports.up = function(knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.float('duration').defaultTo(-1.0);
    t.timestamp('startedAt');
    t.index(['jobID', 'serviceID', 'status', 'duration']);
  });  
};

exports.down = function(knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.dropIndex(['jobID', 'serviceID', 'status', 'duration']);
    t.dropColumn('startedAt');
    t.dropColumn('duration');
  });
};
