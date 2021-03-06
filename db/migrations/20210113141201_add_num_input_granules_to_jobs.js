exports.up = function up(knex) {
  const result = knex.schema
    .alterTable('jobs', (t) => {
      t.integer('numInputGranules').defaultTo(0).notNullable();
    });

  return result;
};

exports.down = function down(knex) {
  return knex.schema
    .alterTable('jobs', (t) => {
      t.dropColumn('numInputGranules');
    });
};