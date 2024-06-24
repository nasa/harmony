exports.up = function (knex) {
  return knex.schema
    .alterTable('jobs', (t) => {
      t.dropIndex('provider_ids');
      t.dropColumn('provider_ids');
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('jobs', (t) => {
      t.specificType('provider_ids', 'text ARRAY').index('jobs_provider_ids_index', 'GIN');
    });
};
