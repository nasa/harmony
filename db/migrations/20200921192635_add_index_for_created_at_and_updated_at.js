exports.up = function (knex) {
  return knex.schema.table('jobs', (t) => {
    t.index(['createdAt']);
    t.index(['updatedAt']);
  });
};

exports.down = function (knex) {
  return knex.schema.table('jobs', (t) => {
    t.dropIndex(['updatedAt']);
    t.dropIndex(['createdAt']);
  });
};
