exports.up = function(knex) {
  return knex.schema.alterTable('jobs', (t) => {
    t.dropColumn('_json_links');
  });
};

exports.down = function(knex) {
  // Just recreate the column, do not try to repopulate the field
  return knex.schema.alterTable('jobs', (t) => {
    t.json('_json_links');
  });
};
