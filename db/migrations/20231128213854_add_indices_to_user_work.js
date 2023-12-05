exports.up = function(knex) {
  return knex.schema.table('user_work', (t) => {
    t.index(['job_id']);
    t.index(['username']);
    t.index(['service_id']);
  });

};

exports.down = function(knex) {
  return knex.schema.table('user_work', (t) => {
    t.dropIndex(['job_id']);
    t.dropIndex(['username']);
    t.dropIndex(['service_id']);
  });  
};
