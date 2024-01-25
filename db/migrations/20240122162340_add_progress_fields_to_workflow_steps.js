exports.up = function up(knex) {
  const result = knex.schema
    .alterTable('workflow_steps', (t) => {
      t.integer('completed_work_item_count').defaultTo(0).notNullable();
      t.float('progress_weight').defaultTo(1).notNullable();
    })
    .then(() => {
      return knex.schema.raw(`
        UPDATE "workflow_steps" SET completed_work_item_count="workItemCount" WHERE is_complete = true
      `
    )});

  return result;
};

exports.down = function down(knex) {
  return knex.schema
    .alterTable('workflow_steps', (t) => {
      t.dropColumn('progress_weight');
      t.dropColumn('completed_work_item_count');
    });
};
