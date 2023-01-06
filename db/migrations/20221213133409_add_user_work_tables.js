const populate_sql = 'INSERT INTO user_work(ready_count, running_count, last_worked, service_id, '
  + 'job_id, username, is_async, "createdAt", "updatedAt") '
  + 'SELECT count(1) filter (WHERE i.status = \'ready\' AND "i"."serviceID" = "ws"."serviceID" AND j.status in (\'running\', \'running_with_errors\', \'accepted\')) as ready_count, '
  + 'count(1) filter (WHERE i.status = \'running\' AND j.status in (\'running\', \'running_with_errors\', \'accepted\')) as running_count, '
  + `"j"."updatedAt", ws."serviceID", "ws"."jobID", j.username, "j"."isAsync", now(), now() `
  + 'FROM workflow_steps ws '
  + 'JOIN jobs j on "ws"."jobID" = "j"."jobID" '
  + 'LEFT JOIN work_items i on "ws"."jobID" = "i"."jobID" AND "i"."jobID" = "j"."jobID" '
  + 'WHERE j.status not in (\'successful\', \'complete_with_errors\', \'failed\', \'canceled\') '
  + 'GROUP BY "j"."updatedAt", "ws"."serviceID", "ws"."jobID", j.username, "j"."isAsync" '
  + 'ORDER BY "j"."updatedAt" asc';

exports.up = function(knex) {
  return knex.schema
    .createTable('user_work', (t) => {
      t.increments('id').primary();
      t.string('username', 255).notNullable();
      t.string('service_id', 255).notNullable();
      t.uuid('job_id').notNullable().references('jobID').inTable('jobs').onDelete('CASCADE');
      t.integer('ready_count').notNullable().defaultTo(0);
      t.integer('running_count').notNullable().defaultTo(0);
      t.boolean('is_async').notNullable();
      t.timestamp('last_worked').notNullable();
      t.timestamp('createdAt').notNullable();
      t.timestamp('updatedAt').notNullable();
      t.unique(['job_id', 'service_id']);
    })
    .raw(populate_sql)
};

exports.down = function(knex) {
  return knex.schema
    .dropTable('user_work');
};
