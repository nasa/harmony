exports.up = function up(knex) {
    return knex.schema
      .alterTable('jobs', (t) => {
        t.specificType('provider_ids', 'text ARRAY').index(null, 'GIN');
      });
  };
  
  exports.down = function down(knex) {
    return knex.schema
      .alterTable('jobs', (t) => {
        t.dropColumn('provider_ids');
        t.dropIndex('provider_ids');
      });
  };
  