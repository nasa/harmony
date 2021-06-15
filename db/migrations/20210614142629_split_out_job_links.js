
exports.up = function(knex) {
  // Modify the jobs table to add a jobID
  return knex.schema
  .alterTable('jobs', (t) => {
    t.uuid('jobID');
    t.unique('jobID');
  })
  .then(() => {
    // Populate the jobID to match the requestID
    return knex('jobs').update({
      jobID: knex.raw('??', ['requestId'])
    });
  })
  .then(() => {
    // Create the job links table
    return knex.schema.createTable('job_links', (t) => {
      t.increments('id')
        .primary();

      t.uuid('jobID')
        .notNullable()
        .references('jobID')
        .inTable('jobs')
        .onDelete('CASCADE');

      t.string('href', 4096)
        .notNullable();

      t.string('type', 255);

      t.string('title', 255);

      t.string('rel', 255);

      t.timestamp('temporalStart');

      t.timestamp('temporalEnd');

      t.string('bbox', 255);

      t.timestamp('createdAt')
        .notNullable();

      t.timestamp('updatedAt')
        .notNullable();

      t.index(['jobID']);
    });
  })
  .then(async () => {
    // Populate the job_links table
    const jobs = await knex.select(['jobID', '_json_links']).from('jobs').forUpdate();
    jobs.forEach(async (job) => {
      let links = job._json_links;
      if (typeof links === 'string') {
        links = JSON.parse(links);
      }
      if (links && links.length > 0) {
        links.forEach(async (link) => {
          const { href, type, title, rel, temporal, bbox } = link;
          const temporalStart = temporal && temporal.start ? new Date(temporal.start) : undefined;
          const temporalEnd = temporal && temporal.end ? new Date(temporal.end) : undefined;
          const now = new Date();
          const createdAt = now;
          const updatedAt = now;
          const bboxString = bbox ? bbox.join(',') : undefined;
          const jobLink = {
            jobID: job.jobID,
            bbox: bboxString,
            href, type, title, rel, temporalStart, temporalEnd, createdAt, updatedAt,
          };

          await knex('job_links').insert(jobLink);
        });
      }
    });
  })
};

exports.down = function(knex) {
  return knex.schema.dropTable('job_links')
  .then(() => {
    return knex.schema.alterTable('jobs', (t) => {
      t.dropColumn('jobID');
    });
  });
};
