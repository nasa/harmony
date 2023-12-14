exports.up = function(knex) {
  return knex.schema
    .table('jobs', function (table) {
      table.index('status');
      table.index('username');
      table.index('service_name');

      table.index(['status', 'createdAt']);
      table.index(['status', 'updatedAt']);
      table.index(['username', 'jobID']);

      // Remove indices that are not needed
      table.dropIndex(['id', 'username', 'requestId'], 'jobs_id_username_requestid_index');
      table.dropIndex(['jobID'], 'jobs_jobid_index');
    })
    .raw('CREATE INDEX idx_jobs_username_isAsync_true ON jobs (username) WHERE "isAsync" = true;');
};

exports.down = function(knex) {
  return knex.schema
    .table('jobs', function (table) {
      table.dropIndex('status');
      table.dropIndex('username');
      table.dropIndex('service_name');

      table.dropIndex(['status', 'createdAt']);
      table.dropIndex(['status', 'updatedAt']);
      table.dropIndex(['username', 'jobID']);
      table.dropIndex(['username', 'isAsync']);

      table.addIndex(['id', 'username', 'requestId'], 'jobs_id_username_requestid_index');
      table.addIndex(['jobID'], 'jobs_jobid_index');
    })
    .raw('DROP INDEX IF EXISTS idx_jobs_username_isAsync_true;');
};
