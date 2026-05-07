exports.up = function (knex) {
  return knex.schema
    .raw(`
      CREATE INDEX work_items_updatedat_status_service_index
      ON work_items ("updatedAt", status, "serviceID");
    `)
    .then(() => knex.schema.createTable('run_watermarks', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
      t.timestamp('last_run_at').notNullable();
    }))
    .then(() => knex('run_watermarks').insert([
      {
        name: 'work_item_stats_update',
        last_run_at: new Date(),
      },
    ]))
    .then(() => knex.schema.createTable('work_items_stats', (t) => {
      t.timestamp('minute').notNullable();
      t.string('service_id').notNullable();
      t.string('status').notNullable();
      t.bigInteger('count').notNullable();

      t.primary(['minute', 'service_id', 'status']);
    }))
    .then(() => knex.schema.raw(`
      CREATE INDEX work_items_stats_service_status_minute_index
      ON work_items_stats (service_id, status, minute);
    `));
};

exports.down = function (knex) {
  return knex.schema
    .raw(`
      DROP INDEX IF EXISTS work_items_updatedat_status_service_index;
    `)
    .then(() => knex.schema.raw(`
      DROP INDEX IF EXISTS work_items_stats_service_status_minute_index;
    `))
    .then(() => knex.schema.dropTableIfExists('run_watermarks'))
    .then(() => knex.schema.dropTableIfExists('work_items_stats'));
};