exports.up = function (knex) {
  return knex.schema
    .raw(`
      CREATE INDEX work_items_ready_lookup_index
      ON work_items ("jobID", status, "serviceID", id)
      WHERE status = 'ready'
    `);
};

exports.down = function (knex) {
  return knex.schema
    .raw(`
      DROP INDEX IF EXISTS work_items_ready_lookup_index;
    `);
};