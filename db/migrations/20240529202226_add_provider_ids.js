exports.up = function up(knex) {
    return knex.schema
      .alterTable('jobs', (t) => {
        t.specificType('provider_ids', 'text ARRAY').index('jobs_provider_ids_index', 'GIN');
      });
  };
  
  exports.down = function down(knex) {
    return knex.schema
      .alterTable('jobs', (t) => {
        t.dropIndex('provider_ids');
        t.dropColumn('provider_ids');
      });
  };
  