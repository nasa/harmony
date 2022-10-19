
exports.up = async function(knex) {
  return knex.schema
  .alterTable('work_items', (t) => {
    t.integer(`sortIndex`).notNullable().defaultTo(0);
    t.text(`outputGranuleSizesJson`)
  })
  .createTable('batches', (t) => {
    t.increments('id')
      .primary();

    t.uuid('jobID')
    .notNullable()
    .references('jobID')
    .inTable('jobs')
    .onDelete('CASCADE');

    t.string('serviceID', 255)
      .notNullable();

    t.integer('batchID');

    t.timestamp('createdAt')
      .notNullable();

    t.timestamp('updatedAt')
      .notNullable();

    t.index(['jobID', 'serviceID', 'batchID']);

    t.index(['jobID', 'batchID']);
    
  })
  .createTable('batch_granules', (t) => {
    t.increments('id')
      .primary();

    t.uuid('jobID')
    .notNullable()
    .references('jobID')
    .inTable('jobs')
    .onDelete('CASCADE');

    t.string('serviceID', 255)
    .notNullable();
    
    t.integer('batchID');


    t.string('granuleUrl', 4096);

    t.bigint('granuleSize').defaultTo(0);

    t.integer('sortIndex');

    t.timestamp('createdAt')
      .notNullable();

    t.timestamp('updatedAt')
      .notNullable();

    t.index(['jobID', 'serviceID', 'batchID']);

    t.index(['jobID', 'batchID']);
  })
  .then(() => {
    knex.schema.alterTable('batch_granules', (t) => {
      t.foreign(['jobID','serviceID', 'batchID'])
        .references(['jobID','serviceID', 'batchID'])
        .on('batches');
    });
  });
};

exports.down = async function(knex) {
  return knex.schema
  .alterTable('work_items', (t) => {
    t.dropColumn(`outputGranuleSizesJson`);
    t.dropColumn(`sortIndex`);
  })
  .dropTable('batch_granules')
  .then(() => {
    return knex.schema.dropTable('batches');
  });
};
