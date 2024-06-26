exports.up = function (knex) {
  return knex.schema.alterTable('service_deployment', (t) => {
    t.string('message', 4096);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('service_deployment', (t) => {
    t.dropColumn('message');
  });
};