#!/usr/bin/env node
// Creates the Iceberg analytics tables in ministack with DuckDB, through ministack's Iceberg REST
// endpoint. bin/create-iceberg-tables uses this instead of `aws s3tables create-table` for
// ministack: tables ministack creates from `create-table --metadata` lose their partition spec
// and have every timestamptz column stored as a string, while AWS keeps both. Tables created
// through the REST endpoint keep them.
//
// Usage:
//   create-ministack-iceberg-tables.mjs <endpoint-url> <region> <bucket-arn> <schema-dir> <table>...
//   create-ministack-iceberg-tables.mjs --print-ddl <schema-dir> <table>...
// where <schema-dir>/<table>.json is the table's `create-table --metadata` JSON. Tables that
// already exist are skipped. Everything is written to stderr, since bin/create-iceberg-tables'
// only stdout output is the bucket ARN.
//
// DuckDB comes from the cron service's dependencies (run `npm install` in services/cron-service).
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

// Iceberg type -> DuckDB type, for the types the analytics tables use
const ICEBERG_TO_DUCKDB = {
  boolean: 'BOOLEAN',
  int: 'INTEGER',
  long: 'BIGINT',
  float: 'FLOAT',
  double: 'DOUBLE',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
  timestamptz: 'TIMESTAMPTZ',
  string: 'VARCHAR',
};

// Iceberg partition transforms DuckDB can create, as the function that applies each one
const PARTITION_TRANSFORMS = new Set(['identity', 'year', 'month', 'day', 'hour']);

const log = (message) => process.stderr.write(`${message}\n`);
const quoteIdentifier = (name) => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (value) => `'${value.replace(/'/g, "''")}'`;

/**
 * Build the CREATE TABLE statement for a table from its `create-table --metadata` JSON
 *
 * @param table - the table name
 * @param metadata - the parsed JSON (`{ iceberg: { schema, partitionSpec?, properties? } }`)
 * @returns the DuckDB statement
 * @throws error if a column type or partition transform has no DuckDB equivalent
 */
function createTableSql(table, metadata) {
  const { schema, partitionSpec, properties = {} } = metadata.iceberg;
  const namesById = new Map();
  const columns = schema.fields.map((field) => {
    const type = ICEBERG_TO_DUCKDB[field.type];
    if (!type) {
      throw new Error(`${table}.${field.name}: no DuckDB type for Iceberg type ${field.type}`);
    }
    if (field.id !== undefined) namesById.set(field.id, field.name);
    return `${quoteIdentifier(field.name)} ${type}`;
  });
  let sql = `CREATE TABLE catalog.iceberg.${quoteIdentifier(table)} (${columns.join(', ')})`;

  const partitions = (partitionSpec?.fields ?? []).map((part) => {
    const column = namesById.get(part.sourceId);
    if (!column) {
      throw new Error(`${table}: partition ${part.name} refers to unknown field id ${part.sourceId}`);
    }
    if (!PARTITION_TRANSFORMS.has(part.transform)) {
      throw new Error(`${table}: unsupported partition transform ${part.transform}`);
    }
    return part.transform === 'identity'
      ? quoteIdentifier(column)
      : `${part.transform}(${quoteIdentifier(column)})`;
  });
  if (partitions.length) {
    sql += ` PARTITIONED BY (${partitions.join(', ')})`;
  }
  // DuckDB requires WITH after PARTITIONED BY
  if (properties['format-version']) {
    sql += ` WITH ('format-version' = ${quoteLiteral(String(properties['format-version']))})`;
  }
  return sql;
}

/**
 * Read each table's schema JSON and build its CREATE TABLE statement
 */
function readTables(schemaDir, tables) {
  return tables.map((table) => {
    const metadata = JSON.parse(readFileSync(join(schemaDir, `${table}.json`), 'utf8'));
    return { table, sql: createTableSql(table, metadata) };
  });
}

/**
 * Attach ministack's Iceberg catalog (writable) the same way the cron service does
 */
async function attachCatalog(conn, endpointUrl, region, bucketArn) {
  const { host } = new URL(endpointUrl);
  await conn.run(`
    INSTALL aws; INSTALL httpfs; INSTALL iceberg;
    LOAD aws; LOAD httpfs; LOAD iceberg;
    CREATE OR REPLACE SECRET ministack_s3 (
      TYPE s3, KEY_ID 'ministack_fake_key', SECRET 'ministack_fake_secret', REGION ${quoteLiteral(region)},
      ENDPOINT ${quoteLiteral(host)}, URL_STYLE 'path', USE_SSL false);
    ATTACH ${quoteLiteral(bucketArn)} AS catalog (
      TYPE iceberg, ENDPOINT ${quoteLiteral(`${endpointUrl.replace(/\/$/, '')}/iceberg`)},
      AUTHORIZATION_TYPE 'sigv4', SECRET ministack_s3, SIGV4_SERVICE 's3tables',
      SIGV4_REGION ${quoteLiteral(region)}, ACCESS_DELEGATION_MODE 'none');`);
}

async function main(args) {
  if (args[0] === '--print-ddl') {
    const [, schemaDir, ...tables] = args;
    readTables(schemaDir, tables).forEach(({ sql }) => log(`${sql};`));
    return;
  }

  const [endpointUrl, region, bucketArn, schemaDir, ...tables] = args;
  if (!endpointUrl || !region || !bucketArn || !schemaDir || tables.length === 0) {
    throw new Error('usage: create-ministack-iceberg-tables.mjs <endpoint-url> <region> <bucket-arn> <schema-dir> <table>...');
  }
  // Build every statement first, so a schema DuckDB can't express fails before anything is created
  const statements = readTables(schemaDir, tables);

  const require = createRequire(new URL('../services/cron-service/package.json', import.meta.url));
  const { DuckDBInstance } = require('@duckdb/node-api');
  // As in the cron service, the aws extension needs an account id to sign ministack requests
  process.env.AWS_ACCOUNT_ID ??= '000000000000';
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  await attachCatalog(conn, endpointUrl, region, bucketArn);

  const reader = await conn.runAndReadAll(
    "SELECT table_name FROM duckdb_tables() WHERE database_name = 'catalog' AND schema_name = 'iceberg'");
  const existing = new Set(reader.getRowObjectsJson().map((row) => String(row.table_name)));

  for (const { table, sql } of statements) {
    if (existing.has(table)) {
      log(`Table '${table}' already exists, skipping.`);
    } else {
      log(`Creating table: ${table}...`);
      await conn.run(sql);
      log(`Table '${table}' created successfully.`);
    }
    log('----------------------------------------');
  }
}

main(process.argv.slice(2)).catch((err) => {
  log(`Error creating Iceberg tables in ministack: ${err.message}`);
  process.exit(1);
});
