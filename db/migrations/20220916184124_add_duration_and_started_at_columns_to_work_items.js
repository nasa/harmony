
exports.up = function(knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.float('duration').defaultTo(-1.0);
    t.timestamp('startedAt');
    t.index(['jobID', 'serviceID', 'duration']);
  });  
};

exports.down = function(knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.dropIndex(['jobID', 'serviceID', 'duration']);
    t.dropColumn('startedAt');
    t.dropColumn('duration');
  });
};
