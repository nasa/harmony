
exports.up = function(knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.double('totalGranulesSize').defaultTo(0);
  })
  .then(() => {
    return knex.schema.alterTable('work_items', async (t) => {
      t.text('totalGranulesSize').notNullable().alter();
    })
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.dropColumn('totalGranulesSize');
  });
};
