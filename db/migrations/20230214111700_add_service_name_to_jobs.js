exports.up = function (knex) {
    return knex.schema.alterTable('jobs', async (t) => {
      t.string('service_name', 255);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.alterTable('jobs', async (t) => {
      t.dropColumn('service_name');
    });
  };