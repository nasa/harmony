
exports.up = function(knex) {
  return knex.schema
    .createTable('workflow_steps', (t) => {
      t.increments('id')
        .primary();

      t.uuid('jobID')
        .notNullable()
        .references('jobID')
        .inTable('jobs')
        .onDelete('CASCADE');

      t.string('serviceID', 255)
        .notNullable();

      t.integer('stepIndex')
        .notNullable();

      t.integer('workItemCount')
        .notNullable();

      t.text('operation')
        .notNullable();

      t.timestamp('createdAt')
        .notNullable();

      t.timestamp('updatedAt')
        .notNullable();

      t.index(['jobID', 'stepIndex', 'serviceID']);
    })
    .createTable('work_items', (t) => {
      t.increments('id')
        .primary();

      t.uuid('jobID')
        .notNullable()
        .references('jobID')
        .inTable('jobs')
        .onDelete('CASCADE');

      t.integer('workflowStepIndex')
        .notNullable();

      t.string('scrollID', 32);

      t.string('serviceID', 255)
        .notNullable();

      t.enu('status', ['ready', 'running', 'successful', 'failed', 'canceled'])
        .notNullable();

      t.string('stacCatalogLocation', 255);

      t.timestamp('createdAt')
        .notNullable();

      t.timestamp('updatedAt')
        .notNullable();

      t.index(['jobID', 'serviceID']);
    })
    .then(() => {
      knex.schema.alterTable('work_items', (t) => {
        t.foreign(['jobID','workflowStepIndex'])
          .references(['jobID','stepIndex'])
          .on('workflow_steps');
    });
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('workflow_steps')
    .then(() => {
      return knex.schema.dropTable('work_items')
    });
};
