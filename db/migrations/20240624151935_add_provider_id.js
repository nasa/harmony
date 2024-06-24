exports.up = function (knex) {
  return knex.schema.alterTable('jobs', async (t) => {
    t.string('provider_id', 255);
    t.index('provider_id');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('jobs', async (t) => {
    t.dropIndex('provider_id');
    t.dropColumn('provider_id');
  });
};