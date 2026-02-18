const path = require('path');

const migrations = { directory: path.resolve(__dirname, 'migrations') };

const sqliteConfig = {
  client: 'sqlite3',
  connection: {
    filename: path.resolve('db', 'test.sqlite3'),
  },
  useNullAsDefault: true,
  migrations,
};

const pgConfig = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_USE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
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
