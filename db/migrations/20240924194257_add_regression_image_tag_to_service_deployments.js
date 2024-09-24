exports.up = function (knex) {
  return knex.schema.alterTable('service_deployments', (t) => {
    t.string('regression_image_tag');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('service_deployments', (t) => {
    t.dropColumn('regression_image_tag');
  });
};