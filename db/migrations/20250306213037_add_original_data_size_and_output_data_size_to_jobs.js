exports.up = function up(knex) {
  return knex.schema.alterTable('jobs', (t) => {
    t.double('original_data_size');
    t.double('output_data_size');
  });
};

exports.down = function down(knex) {
  return knex.schema.table('jobs', (t) => {
    t.dropColumn('output_data_size');
    t.dropColumn('original_data_size');
  });
};