/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('users_labels', (t) => {
      t.increments('id')
        .primary();

      t.string('username').notNullable();

      t.string('value', 255).notNullable();

      t.timestamp('createdAt')
        .notNullable();

      t.timestamp('updatedAt')
        .notNullable();

      t.unique(['username', 'value']);
      t.index(['username']);
      t.index(['value']);
    })
    .then(async () => {
      // Populate the raw_labels, jobs_raw_labels, and users_labels tables
      const now = new Date();
      const rows = await knex.select(['username', 'job_id', 'value']).from('jobs_labels').innerJoin('labels', 'jobs_labels.label_id', '=', 'labels.id');
      const uniqueRawLabels = Array.from(new Set(rows.map((row) => row.value)));
      const rawLabelRows = uniqueRawLabels.map((value) => { return { value, createdAt: now, updatedAt: now, }; });
      const labelIdValues = await knex('raw_labels').insert(rawLabelRows).returning(['id', 'value']);
      // make a map of values to row ids
      const labelValueIds = labelIdValues.reduce((acc, idValue) => {
        const { id, value } = idValue;
        acc[value] = id;
        return acc;
      }, {});

      let jobsRawLabelRows = [];
      let usersLabelsRows = [];

      rows.forEach((row) => {
        const jobID = row.job_id;
        const { username, value } = row;
        const labelId = labelValueIds[value];

        jobsRawLabelRows.push({ job_id: jobID, label_id: labelId, createdAt: now, updatedAt: now });
        usersLabelsRows.push({ username, value, createdAt: now, updatedAt: now });
      });
      // remove duplicates
      jobsRawLabelRows = Array.from(new Set(jobsRawLabelRows.map(JSON.stringify))).map(JSON.parse);
      usersLabelsRows = Array.from(new Set(usersLabelsRows.map(JSON.stringify))).map(JSON.parse);
      await knex('jobs_raw_labels').insert(jobsRawLabelRows);
      await knex('users_labels').insert(usersLabelsRows);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('users_labels');
};
