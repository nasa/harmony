
exports.up = function(knex) {
  return knex.schema.table('jobs', (t) => {
    t.index(['jobID']);
  })
  .table('work_items', (t) => {
    t.index(['status'])
  });
};

exports.down = function(knex) {
  return knex.schema.table('jobs', (t) => {
    t.dropIndex(['jobID']);
  })
  .table('work_items', (t) => {
    t.dropIndex(['status'])
  });
};
