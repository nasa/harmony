/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('job_links', (t) => {
    t.text('href').alter();
  })

};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('job_links', (t) => {
    // I don't anticipate we would ever run this down migration, but if we do, it will truncate
    // any long urls to be 4096, which is not good, but what else can we do?
    t.string('href', 4096).alter();
  })

};
