const path = require('path');

const migrations = { directory: path.resolve(__dirname, 'migrations') };

module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: path.resolve(__dirname, 'development.sqlite3'),
    },
    useNullAsDefault: true,
    debug: (process.env.DEBUG_KNEX === 'true'),
    migrations,
  },

  test: {
    client: 'sqlite3',
    connection: {
      filename: path.resolve(__dirname, 'test.sqlite3'),
    },
    useNullAsDefault: true,
    migrations,
  },

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: {
      min: 0,
      max: 7,
    },
    searchPath: ['knex', 'public'],
    migrations,
    acquireConnectionTimeout: 120000, // Allow adequate warmup of serverless aurora
  },
};
