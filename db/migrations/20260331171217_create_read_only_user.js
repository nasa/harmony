exports.up = async function(knex) {
  if (knex.client.config.client !== 'pg') {
    return;
  }

  const password = process.env.DATABASE_READONLY_PASSWORD;
  if (!password) {
    return;
  }

  const { rows } = await knex.raw(
    `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'harmony_read_only'`
  );

  if (rows.length === 0) {
    const escapedPassword = password.replace(/'/g, "''");
    await knex.raw(`CREATE ROLE harmony_read_only WITH LOGIN PASSWORD '${escapedPassword}'`);
  }

  await knex.raw(`GRANT USAGE ON SCHEMA public TO harmony_read_only`);
  await knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO harmony_read_only`);
  await knex.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO harmony_read_only`);
};

exports.down = async function(knex) {
  if (knex.client.config.client !== 'pg') {
    return;
  }

  const { rows } = await knex.raw(
    `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'harmony_read_only'`
  );

  if (rows.length === 0) {
    return;
  }

  await knex.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM harmony_read_only`);
  await knex.raw(`REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM harmony_read_only`);
  await knex.raw(`REVOKE USAGE ON SCHEMA public FROM harmony_read_only`);
  await knex.raw(`DROP ROLE IF EXISTS harmony_read_only`);
};
