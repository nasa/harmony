const environment = process.env.NODE_ENV || 'development';
import knexfile = require('../../db/knexfile');
const config = knexfile[environment];

// Import has to happen after the knexfile, so disable that rule
// eslint-disable-next-line import/order
import knex = require('knex');
const database: any = knex(config);

database.engine = config.client;
database.config = config;

export = database;
