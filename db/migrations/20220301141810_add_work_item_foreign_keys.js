
exports.up = function(knex) {
  return knex.schema.table('work_items', (t) => {
    t.foreign(['jobID','workflowStepIndex'])
      .references(['jobID','stepIndex'])
      .inTable('workflow_steps');
  });
};

exports.down = function(knex) {
  return knex.schema.table('work_items', (t) => {
    t.dropForeign(['jobID','workflowStepIndex']);
  });
};
