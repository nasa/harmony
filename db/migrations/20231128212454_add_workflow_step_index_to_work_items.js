exports.up = function(knex) {
  return knex.schema.table('work_items', (t) => {
    t.index(['jobID', 'workflowStepIndex', 'status']);
  });

};

exports.down = function(knex) {
  return knex.schema.table('work_items', (t) => {
    t.dropIndex(['jobID', 'workflowStepIndex', 'status']);
  });  
};
