exports.up = function (knex) {
  return knex.schema.alterTable('service_deployments', (t) => {
    t.string('regression_test_version', 255);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('service_deployments', (t) => {
    t.dropColumn('regression_test_version');
  });
};