// Add destination_url to jobs table for putting results in user specified S3 bucket
exports.up = function (knex) {
  return knex.schema.alterTable('jobs', async (t) => {
    t.string('destination_url', 8192);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('jobs', async (t) => {
    t.dropColumn('destination_url');
  });
};