exports.up = async function up(knex) {
  await knex.schema.alterTable('user_work', (t) => {
    t.integer('average_duration');
    t.integer('completed_count').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('user_work', (t) => {
    t.dropColumn('average_duration');
    t.dropColumn('completed_count');
  });
};
