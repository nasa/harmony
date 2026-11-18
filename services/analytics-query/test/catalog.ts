import { expect } from 'chai';
import { describe, it } from 'mocha';

import { hookFixtureDb } from './helpers/db';
import { allowedDirectories } from '../app/query/catalog';

// Run directly on a connection, bypassing the validator, so these show what the connection refuses
// by itself. Every one must fail.
const REFUSED: [string, string, RegExp][] = [
  ['delete from the catalog', 'DELETE FROM catalog.iceberg.jobs WHERE false', /read-only mode/],
  ['insert into the catalog', 'INSERT INTO catalog.iceberg.jobs (id) SELECT -1 WHERE false', /read-only mode/],
  ['create a table in the catalog', 'CREATE TABLE catalog.iceberg.probe (x INTEGER)', /read-only mode/],
  ['create a macro in the default schema', 'CREATE MACRO probe(x) AS x + 1', /read-only mode/],
  ['read a local file', 'SELECT * FROM read_text(\'/etc/passwd\')', /disabled by configuration/],
  ['glob the local filesystem', 'SELECT * FROM glob(\'/etc/*\')', /disabled by configuration/],
  ['smuggle a read through query()', 'SELECT * FROM query(\'SELECT * FROM read_text(\'\'/etc/passwd\'\')\')', /disabled by configuration/],
  ['fetch over http (SSRF)', 'SELECT * FROM read_json(\'http://169.254.169.254/latest/meta-data/\')', /disabled by configuration|httpfs/],
  ['write a local file', 'COPY (SELECT 1) TO \'/tmp/analytics-query-copy-probe.csv\'', /disabled by configuration/],
  ['attach another database file', 'ATTACH \'/tmp/analytics-query-attach-probe.duckdb\' AS other', /disabled by configuration/],
  ['re-enable external access', 'SET enable_external_access = true', /configuration has been locked/],
  ['unlock the configuration', 'SET lock_configuration = false', /configuration has been locked/],
  ['RESET a locked setting', 'RESET enable_external_access', /configuration has been locked/],
  ['raise the memory limit', 'SET memory_limit = \'100GB\'', /configuration has been locked/],
  ['change the timezone', 'SET TimeZone = \'America/New_York\'', /configuration has been locked/],
  ['install an extension', 'INSTALL spatial', /disabled by configuration/],
  ['load an extension', 'LOAD spatial', /disabled through configuration/],
];

describe('the locked-down catalog connection', () => {
  const { db } = hookFixtureDb();

  for (const [name, sql, error] of REFUSED) {
    it(`refuses to ${name}`, async () => {
      await expect(db().withConnection((conn) => conn.run(sql))).to.be.rejectedWith(error);
    });
  }

  it('still reads the catalog', async () => {
    const rows = await db().withConnection(async (conn) =>
      (await conn.runAndReadAll('SELECT count(*)::INTEGER AS n FROM jobs')).getRowObjectsJson());
    expect(rows[0].n).to.be.greaterThan(0);
  });

  it('uses UTC on every connection', async () => {
    const rows = await db().withConnection(async (conn) =>
      (await conn.runAndReadAll("SELECT current_setting('TimeZone') AS tz")).getRowObjectsJson());
    expect(rows[0].tz).to.equal('UTC');
  });
});

describe('allowedDirectories', () => {
  it('allows only the ministack endpoint and S3 for ministack', () => {
    expect(allowedDirectories({ kind: 'ministack', bucketArn: 'arn', region: 'us-west-2', localstackHost: 'localhost' }))
      .to.eql(['http://localhost:4566/', 's3://']);
  });

  it('allows only the S3 Tables endpoint and S3 for AWS', () => {
    expect(allowedDirectories({ kind: 'aws', bucketArn: 'arn', region: 'us-west-2' }))
      .to.eql(['https://s3tables.us-west-2.amazonaws.com/', 's3://']);
  });

  it('allows nothing for the fixture', () => {
    expect(allowedDirectories({ kind: 'fixture', path: '/tmp/x' })).to.eql([]);
  });
});
