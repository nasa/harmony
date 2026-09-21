const TABLES = [
  'batch_items', 'batches', 'job_links', 'job_messages', 'jobs_raw_labels',
  'raw_labels', 'service_deployments', 'users_labels', 'work_items', 'workflow_steps',
];

const indexName = (table) => `${table}_updatedat_id_index`;

// Disable the migration-wide transaction so each index gets its own transaction
exports.config = { transaction: false };

exports.up = async function (knex) {
  for (const table of TABLES) {
    await knex.transaction(async (trx) => {
      await trx.raw('CREATE INDEX IF NOT EXISTS ?? ON ?? ("updatedAt", "id")', [indexName(table), table]);
    });
  }
};

exports.down = async function (knex) {
  for (const table of TABLES) {
    await knex.transaction(async (trx) => {
      await trx.raw('DROP INDEX IF EXISTS ??', [indexName(table)]);
    });
  }
};