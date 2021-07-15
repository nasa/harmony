exports.up = function up(knex) {
    const result = knex.schema
      .alterTable('jobs', (t) => {
        t.text('collectionIds');
      });
  
    return result;
  };
  
  exports.down = function down(knex) {
    return knex.schema
      .alterTable('jobs', (t) => {
        t.dropColumn('collectionIds');
      });
  };