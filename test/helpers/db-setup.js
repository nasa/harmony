process.env.NODE_ENV = 'test'; // Ensure we're immediately using the right DB

const { before } = require('mocha');
const db = require('../../app/util/db');

const tables = ['jobs'];

before(async function () {
  await db.migrate.latest();
  // Truncate all tables
  await Promise.all(tables.map((t) => db(t).truncate()));
});
