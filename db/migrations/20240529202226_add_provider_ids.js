exports.up = function up(knex) {
    return knex.schema
      .alterTable('jobs', (t) => {
        t.specificType('providerIds', 'text ARRAY').index(null, 'GIN');
      });
  };
  
  exports.down = function down(knex) {
    return knex.schema
      .alterTable('jobs', (t) => {
        t.dropColumn('providerIds');
        t.dropIndex('providerIds');
      });
  };
  