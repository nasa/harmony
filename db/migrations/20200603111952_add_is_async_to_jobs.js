
exports.up = function up(knex) {
  const result = knex.schema
    .alterTable('jobs', (t) => {
      t.boolean('isAsync');
    });
  // For records created before this change, err on the side of showing all
  // prior requests
  knex('jobs').update({ isAsync: true });
  return result;
};

exports.down = function down(knex) {
  return knex.schema
    .alterTable('jobs', (t) => {
      t.dropColumn('isAsync');
    });
};
