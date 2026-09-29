exports.up = function up(knex) {
  return knex.schema.alterTable('jobs', (t) => {
    t.string('request_checksum');
  })
    .then(() =>
      knex.schema.table('jobs', function (table) {
        table.index(['request_checksum']);
      })
    );
};

exports.down = function down(knex) {
  return knex.schema.table('jobs', (t) => {
    t.dropColumn('request_checksum');
  });
};