const environment = process.env.NODE_ENV || 'development';
const config = require('../../db/knexfile')[environment];

// Import has to happen after the knexfile, so disable that rule
// eslint-disable-next-line import/order
const database = require('knex')(config);

database.engine = config.client;

module.exports = database;
