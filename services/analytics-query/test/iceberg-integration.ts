import { expect } from 'chai';
import { after, before, describe, it } from 'mocha';

import { TEST_DB_OPTIONS } from './helpers/db';
import { AnalyticsDb } from '../app/query/analytics-db';
import { CatalogSource } from '../app/query/catalog';
import { loadSchema, tableNames } from '../app/query/schema';
import { validateSql } from '../app/query/validate';
import log from '../app/util/log';

// The rest of the suite uses a local DuckDB file in place of the Iceberg catalog. These run the
// lockdown checks against the real thing: set ANALYTICS_QUERY_ICEBERG_TEST=ministack (with the local
// dev ministack running, and LOCALSTACK_HOST pointing at it) to run them. The first run downloads
// the DuckDB extensions, so it needs network access.
const enabled = process.env.ANALYTICS_QUERY_ICEBERG_TEST === 'ministack';

(enabled ? describe : describe.skip)('against the ministack Iceberg catalog', function () {
  this.timeout(120_000);
  const region = process.env.AWS_DEFAULT_REGION || 'us-west-2';
  const source: CatalogSource = {
    kind: 'ministack',
    bucketArn: `arn:aws:s3tables:${region}:000000000000:bucket/harmony-analytics`,
    region,
    localstackHost: process.env.LOCALSTACK_HOST || 'localhost',
  };
  // Constructing it doesn't connect to anything; init() does
  const db = new AnalyticsDb(source, TEST_DB_OPTIONS, log);

  before(async () => {
    await db.init();
  });
  after(() => db.close());

  it('lists the analytics tables', async () => {
    const schema = await db.withConnection(loadSchema);
    expect([...tableNames(schema)]).to.include.members(['jobs', 'work_items']);
  });

  // The Iceberg catalog only loads a table's columns once a query uses it, listing a placeholder
  // column until then - which a DuckDB file fixture can't reproduce
  it('lists every table\'s real columns, on a fresh instance', async () => {
    const fresh = new AnalyticsDb(source, TEST_DB_OPTIONS, log);
    try {
      const schema = await fresh.withConnection(loadSchema);
      for (const table of schema.tables) {
        expect(table.columns.length, table.name).to.be.greaterThan(1);
        expect(table.columns.filter((c) => c.type === 'UNKNOWN' || c.name === '__'), table.name).to.eql([]);
      }
      const jobs = schema.tables.find((t) => t.name === 'jobs');
      expect(jobs.columns).to.deep.include({ name: 'updated_at', type: 'TIMESTAMP WITH TIME ZONE' });
    } finally {
      fresh.close();
    }
  });

  it('reads the tables through the lockdown', async () => {
    const rows = await db.withConnection(async (conn) =>
      (await conn.runAndReadAll('SELECT count(*)::INTEGER AS n FROM jobs')).getRowObjectsJson());
    expect(rows[0].n).to.be.a('number');
  });

  it('validates queries against the Iceberg tables, case-sensitively', async () => {
    const tables = tableNames(await db.withConnection(loadSchema));
    const valid = await db.withConnection((conn) => validateSql(conn, 'SELECT status, count(*) FROM jobs GROUP BY 1', tables));
    expect(valid.valid).to.be.true;
    // The validator catches this first; without it the REST catalog would fail the lookup
    const wrongCase = await db.withConnection((conn) => validateSql(conn, 'SELECT * FROM JOBS', tables));
    expect(wrongCase.errors[0].message).to.equal('Table names are case-sensitive: use jobs');
  });

  // Writes run in a rolled-back transaction, so even if READ_ONLY weren't honored nothing commits
  for (const [name, sql] of [
    ['delete', 'DELETE FROM catalog.iceberg.jobs WHERE false'],
    ['insert', 'INSERT INTO catalog.iceberg.jobs (id) SELECT -1 WHERE false'],
    ['create a table', 'CREATE TABLE catalog.iceberg.analytics_query_probe (x INTEGER)'],
  ]) {
    it(`refuses to ${name} in the catalog`, async () => {
      await db.withConnection(async (conn) => {
        await conn.run('BEGIN');
        try {
          await expect(conn.run(sql)).to.be.rejectedWith(/read-only mode/);
        } finally {
          await conn.run('ROLLBACK').catch(() => {});
        }
      });
    });
  }

  for (const [name, sql] of [
    ['read a local file', 'SELECT * FROM read_text(\'/etc/passwd\')'],
    ['fetch the instance metadata endpoint', 'SELECT * FROM read_json(\'http://169.254.169.254/latest/meta-data/\')'],
    ['fetch another URL', 'SELECT * FROM read_text(\'https://example.com/\')'],
  ]) {
    it(`refuses to ${name}, even with the catalog's endpoints allowed`, async () => {
      await expect(db.withConnection((conn) => conn.run(sql))).to.be.rejectedWith(/disabled by configuration/);
    });
  }
});
