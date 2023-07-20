const path = require('path');

const migrations = { directory: path.resolve(__dirname, 'migrations') };

const sqliteConfig = {
  client: 'sqlite3',
  connection: {
    filename: path.resolve(__dirname, 'test.sqlite3'),
  },
  useNullAsDefault: true,
  migrations,
};

const pgConfig = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: {
    min: 0,
    max: 100,
  },
  searchPath: ['knex', 'public'],
  migrations,
  acquireConnectionTimeout: 120000, // Allow adequate warmup of serverless aurora
  onUpdateTrigger: table => `
    CREATE TRIGGER ${table}_updated_at
    BEFORE UPDATE ON ${table}
    FOR EACH ROW
    EXECUTE PROCEDURE on_update_timestamp();
  `
};

module.exports = process.env.DATABASE_TYPE === 'sqlite' ? sqliteConfig : pgConfig;
