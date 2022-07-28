exports.up = function up(knex) {
  const result = knex.schema
    .alterTable('work_items', (t) => {
      t.string('scrollID', 4096).alter();
    });

  return result;
};

exports.down = function down(knex) {
  // Does nothing as we might break things if we try to reduce the column size and already
  // have rows with longer entries in the `scrollID` co]umn
};
