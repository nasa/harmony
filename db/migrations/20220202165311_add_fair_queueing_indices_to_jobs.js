
exports.up = function(knex) {
  return knex.schema.table('jobs', (t) => {
    t.index(['username']);
  });
};

exports.down = function(knex) {
  return knex.schema.table('jobs', (t) => {
    t.dropIndex(['username']);
  });
};
