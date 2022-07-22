exports.up = function up(knex) {
  const result = knex.schema
    .alterTable('work_items', (t) => {
      t.string('scrollID', 4096).alter();
    });

  return result;
};

exports.down = function down(knex) {
  return knex.schema
    .alterTable('work_items', (t) => {
      t.string('scrollID', 32).alter();
    });
};
