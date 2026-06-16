exports.up = function (knex) {
    return knex.schema
      .table('work_items', function (table) {
        table.index(['jobID', 'workflowStepIndex']);
        table.index(['jobID', 'id']);
        table.index(['serviceID']);
      })
  
      .then(() =>
        knex.schema.table('jobs', function (table) {
          table.index(['status', 'updatedAt', 'jobID']);
        })
      )
  
      .then(() =>
        knex.schema.table('workflow_steps', function (table) {
          table.index(['jobID', 'id']);
        })
      )
  
      .then(() =>
        knex.raw(`
          DROP TRIGGER IF EXISTS user_work_updated_at ON user_work;
        `)
      );
  };
  
  exports.down = function (knex) {
    return knex.schema
      .table('work_items', function (table) {
        table.dropIndex(['jobID', 'workflowStepIndex']);
        table.dropIndex(['jobID', 'id']);
        table.dropIndex(['serviceID']);
      })
  
      .then(() =>
        knex.schema.table('jobs', function (table) {
          table.dropIndex(['status', 'updatedAt', 'jobID']);
        })
      )
  
      .then(() =>
        knex.schema.table('workflow_steps', function (table) {
          table.dropIndex(['jobID', 'id']);
        })
      )
  
      .then(() =>
        knex.raw(`
          CREATE TRIGGER "user_work_updated_at"
          BEFORE UPDATE ON user_work
          FOR EACH ROW
          EXECUTE FUNCTION on_update_timestamp();
        `)
      );
  };