const populate_sql = 'INSERT INTO user_work(ready_count, running_count, last_worked, service_id, '
  + 'job_id, username, "createdAt", "updatedAt") '
  + 'SELECT count(1) filter (WHERE i.status = \'ready\') as ready_count, '
  + 'count(1) filter (WHERE i.status = \'running\') as running_count, '
  + '"j"."updatedAt", i."serviceID", "i"."jobID", j.username, now(), now() '
  + 'FROM work_items i, jobs j WHERE "i"."jobID" = "j"."jobID" '
  + 'AND j.status not in (\'paused\', \'previewing\') '
  + 'AND "i"."status" in (\'ready\', \'running\') '
  + 'GROUP BY "j"."updatedAt", "i"."serviceID", "i"."jobID", j.username '
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
