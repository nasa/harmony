exports.up = function (knex) {
  return knex.schema
    .table('batch_items', function (table) {
      table.index(['updatedAt', 'id']);
    })

    .then(() =>
      knex.schema.table('batches', function (table) {
        table.index(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('job_links', function (table) {
        table.index(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('job_messages', function (table) {
        table.index(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('jobs_raw_labels', function (table) {
        table.index(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('raw_labels', function (table) {
        table.index(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('service_deployments', function (table) {
        table.index(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('users_labels', function (table) {
        table.index(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('work_items', function (table) {
        table.index(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('workflow_steps', function (table) {
        table.index(['updatedAt', 'id']);
      })
    );
};

exports.down = function (knex) {
  return knex.schema
    .table('batch_items', function (table) {
      table.index(['updatedAt', 'id']);
    })

    .then(() =>
      knex.schema.table('batches', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('job_links', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('job_messages', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('jobs_raw_labels', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('raw_labels', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('service_deployments', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('users_labels', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('work_items', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    )

    .then(() =>
      knex.schema.table('workflow_steps', function (table) {
        table.dropIndex(['updatedAt', 'id']);
      })
    );
};