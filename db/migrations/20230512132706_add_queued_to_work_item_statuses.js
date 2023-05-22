const formatAlterTableEnumSql = (
  tableName,
  columnName,
  enums,
) => {
  const constraintName = `${tableName}_${columnName}_check`;
  return [
    `ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${constraintName};`,
    `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} CHECK (${columnName} = ANY (ARRAY['${enums.join(
      "'::text, '"
    )}'::text]));`,
  ].join('\n');
};


exports.up = async function up(knex) {
  await knex.raw(
    formatAlterTableEnumSql('work_items', 'status', [
      'ready',
      'queued',
      'running',
      'successful',
      'failed',
      'canceled'
    ])
  );
};

exports.down = async function down(knex) {
  await knex.raw(
    formatAlterTableEnumSql('work_items', 'status', [
      'ready',
      'running',
      'successful',
      'failed',
      'canceled'
    ])
  );
};