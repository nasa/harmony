const INDEX_NAME = 'jobs_request_checksum_username_index';

// CREATE INDEX CONCURRENTLY cannot run inside a transaction
exports.config = { transaction: false };

exports.up = async function up(knex) {
  await knex.schema.alterTable('jobs', (t) => {
    t.string('request_checksum');
  });
  await knex.raw(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS ?? ON ?? ("request_checksum", "username")',
    [INDEX_NAME, 'jobs']
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS ??', [INDEX_NAME]);
  await knex.schema.alterTable('jobs', (t) => {
    t.dropColumn('request_checksum');
  });
};
