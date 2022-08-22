exports.up = function (knex) {
  return knex.schema.table('work_items', (t) => {
    t.index(['serviceID', 'status']);
  });
};

exports.down = function (knex) {
  return knex.schema.table('work_items', (t) => {
    t.dropIndex(['serviceID', 'status']);
  });
};
