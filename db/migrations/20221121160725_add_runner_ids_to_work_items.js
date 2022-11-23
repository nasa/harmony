exports.up = async function (knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.text('runners').defaultTo('[]');
  })
    .then(() => {
      return knex.schema.alterTable('work_items', async (t) => {
        t.text('runners').notNullable().alter();
      })
    });
}

exports.down = async function (knex) {
  await knex.schema.alterTable('work_items', async (t) => {
    t.dropColumn('runners');
  });
}