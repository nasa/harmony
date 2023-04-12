const { onUpdateTrigger } = require('../knexfile');

exports.up = function(knex) {
  return knex.raw(onUpdateTrigger('batch_items'))
  .then(() => knex.raw(onUpdateTrigger('batches')))
  .then(() => knex.raw(onUpdateTrigger('job_errors')))
  .then(() => knex.raw(onUpdateTrigger('job_links')))
  .then(() => knex.raw(onUpdateTrigger('jobs')))
  .then(() => knex.raw(onUpdateTrigger('user_work')))
  .then(() => knex.raw(onUpdateTrigger('work_items')))
  .then(() => knex.raw(onUpdateTrigger('workflow_steps')));
};

exports.down = function(knex) {
  return  knex.raw('DROP TRIGGER IF EXISTS batch_items_updated_at ON batch_items')
  .then(() => knex.raw('DROP TRIGGER IF EXISTS batches_updated_at ON batches'))
  .then(() => knex.raw('DROP TRIGGER IF EXISTS job_errors_updated_at ON job_errors'))
  .then(() => knex.raw('DROP TRIGGER IF EXISTS job_links_updated_at ON job_links'))
  .then(() => knex.raw('DROP TRIGGER IF EXISTS jobs_updated_at ON jobs'))
  .then(() => knex.raw('DROP TRIGGER IF EXISTS user_work_updated_at ON user_work'))
  .then(() => knex.raw('DROP TRIGGER IF EXISTS work_items_updated_at ON work_items'))
  .then(() => knex.raw('DROP TRIGGER IF EXISTS workflow_steps_updated_at ON workflow_steps'));
};
