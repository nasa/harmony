
exports.up = function(knex) {
  // Create the job errors table
  return knex.schema.createTable('job_errors', (t) => {
    t.increments('id')
      .primary();

    t.uuid('jobID')
      .notNullable()
      .references('jobID')
      .inTable('jobs')
      .onDelete('CASCADE');

    t.string('url', 4096)
      .notNullable();

    t.string('message', 4096)
      .notNullable();

    t.timestamp('createdAt')
      .notNullable();

    t.timestamp('updatedAt')
      .notNullable();

    t.index(['jobID']);
  })
  .then(() => {
    // Add complete_with_errors state
    return knex.schema.raw(`
      ALTER TABLE "jobs"
      DROP CONSTRAINT "jobs_status_check",
      ADD CONSTRAINT "jobs_status_check"
      CHECK (status IN ('accepted', 'running', 'successful', 'complete_with_errors', 'failed', 'canceled', 'paused', 'previewing'))
    `);
  })
  .then(() => {
    // Add ignoreErrors column
    return knex.schema
    .alterTable('jobs', (t) => {
      t.boolean('ignoreErrors').defaultTo(false).notNullable();
    });
  })
};

exports.down = function(knex) {
  return knex.schema.dropTable('job_errors')
  .then(() => {
    return knex.schema.raw(`
      ALTER TABLE "jobs"
      DROP CONSTRAINT "jobs_status_check",
      ADD CONSTRAINT "jobs_status_check"
      CHECK (status IN ('accepted', 'running', 'successful', 'failed', 'canceled', 'paused', 'previewing'))
    `);
  })
  .then(() => {
    return knex.schema
    .alterTable('jobs', (t) => {
      t.dropColumn('ignoreErrors');
    });
  })
};
