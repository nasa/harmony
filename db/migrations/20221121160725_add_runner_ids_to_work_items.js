exports.up = async function (knex) {
  return knex.schema.alterTable('work_items', async (t) => {
    t.text('runnerIds').defaultTo('[]');
  })
    .then(() => {
      return knex.schema.alterTable('work_items', async (t) => {
        t.text('runnerIds').notNullable().alter();
      })
    });
}

exports.down = async function (knex) {
  await knex.schema.alterTable('work_items', async (t) => {
    t.dropColumn('runnerIds');
  });
}