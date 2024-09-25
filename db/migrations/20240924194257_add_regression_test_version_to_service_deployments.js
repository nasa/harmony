exports.up = function (knex) {
  return knex.schema.alterTable('service_deployments', (t) => {
    t.string('regression_test_version');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('service_deployments', (t) => {
    t.dropColumn('regression_test_version');
  });
};