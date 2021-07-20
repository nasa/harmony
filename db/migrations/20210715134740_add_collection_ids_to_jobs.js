exports.up = async function(knex) {
  return knex.schema.alterTable('jobs', async (t) => {
    t.text('collectionIds').defaultTo('[]');
  })
  .then(() => {
    return knex.schema.alterTable('jobs', async (t) => {
      t.text('collectionIds').notNullable().alter();
    })
  });
}

exports.down = async function(knex) {
  await knex.schema.alterTable('jobs', async (t) => {
    t.dropColumn('collectionIds');
  });
}