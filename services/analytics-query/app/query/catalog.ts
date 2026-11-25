import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';

// The name the Iceberg catalog is attached as, and the namespace the analytics tables are in
export const CATALOG = 'catalog';
export const SCHEMA = 'iceberg';

/**
 * Where the analytics tables come from
 */
export type CatalogSource =
  // A DuckDB database file with an `iceberg` schema, standing in for the Iceberg catalog in tests
  | { kind: 'fixture'; path: string }
  // The local development ministack S3 Tables
  | { kind: 'ministack'; bucketArn: string; region: string; localstackHost: string }
  // An AWS S3 Table bucket
  | { kind: 'aws'; bucketArn: string; region: string };

export interface InstanceLimits {
  memoryLimit: string;
  threads: number;
}

const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

// The extensions reading the Iceberg tables needs. iceberg reads its manifests with avro, which
// DuckDB would otherwise autoinstall on first use - but autoinstall is disabled below.
const ICEBERG_EXTENSIONS = ['aws', 'httpfs', 'avro', 'iceberg'];

/**
 * Get the SQL that attaches the catalog READ_ONLY. For Iceberg this mirrors the cron service's
 * initDbConnection (services/cron-service/app/util/db/iceberg-connection.ts), which writes it.
 */
function attachSql(source: CatalogSource): string {
  if (source.kind === 'fixture') {
    return `ATTACH ${quoteLiteral(source.path)} AS ${CATALOG} (READ_ONLY);`;
  }
  // INSTALL is a no-op for an extension that's already installed (as they are in the Docker image)
  const extensions = ICEBERG_EXTENSIONS.map((e) => `INSTALL ${e}; LOAD ${e};`).join(' ');
  if (source.kind === 'ministack') {
    const { bucketArn, region, localstackHost } = source;
    return `${extensions}
      CREATE OR REPLACE SECRET ministack_s3 (TYPE s3, KEY_ID 'ministack_fake_key', SECRET 'ministack_fake_secret',
        REGION ${quoteLiteral(region)}, ENDPOINT ${quoteLiteral(`${localstackHost}:4566`)}, URL_STYLE 'path', USE_SSL false);
      ATTACH ${quoteLiteral(bucketArn)} AS ${CATALOG} (TYPE iceberg, READ_ONLY,
        ENDPOINT ${quoteLiteral(`http://${localstackHost}:4566/iceberg`)}, AUTHORIZATION_TYPE 'sigv4',
        SECRET ministack_s3, SIGV4_SERVICE 's3tables', SIGV4_REGION ${quoteLiteral(region)},
        ACCESS_DELEGATION_MODE 'none');`;
  }
  return `${extensions}
    CREATE OR REPLACE SECRET (TYPE s3, PROVIDER credential_chain);
    ATTACH ${quoteLiteral(source.bucketArn)} AS ${CATALOG} (TYPE iceberg, READ_ONLY, ENDPOINT_TYPE s3_tables);`;
}

/**
 * Get the path prefixes the catalog itself needs to read once external access is turned off: its
 * REST endpoint and the S3 objects holding the table metadata and data. Everything else - local
 * files, other URLs (including the instance metadata endpoint) - stays blocked.
 */
export function allowedDirectories(source: CatalogSource): string[] {
  switch (source.kind) {
    case 'fixture': return [];
    case 'ministack': return [`http://${source.localstackHost}:4566/`, 's3://'];
    default: return [`https://s3tables.${source.region}.amazonaws.com/`, 's3://'];
  }
}

/**
 * Create a DuckDB instance that can only read the catalog.
 *
 * Setup runs with full access (loading extensions, creating the secret, attaching the catalog
 * READ_ONLY), then external access is turned off - except for the prefixes the catalog needs -
 * and the configuration is locked, so no query can turn any of it back on. Writes to the catalog
 * are refused by the READ_ONLY attach, and the deployed service's IAM role is read-only as well.
 *
 * @param source - where the analytics tables come from
 * @param limits - DuckDB's memory limit and thread count
 * @returns the instance - get connections from it with openConnection
 * @throws error if the catalog can't be attached
 */
export async function createLockedInstance(source: CatalogSource, limits: InstanceLimits): Promise<DuckDBInstance> {
  const instance = await DuckDBInstance.create(':memory:', {
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
    allow_community_extensions: 'false',
    allow_persistent_secrets: 'false',
    memory_limit: limits.memoryLimit,
    threads: String(limits.threads),
  });
  let conn: DuckDBConnection | null = null;
  try {
    conn = await instance.connect();
    if (source.kind === 'ministack') {
      // As in the cron service, the aws extension needs an account id to sign ministack requests
      process.env.AWS_ACCOUNT_ID ??= '000000000000';
    }
    await conn.run(attachSql(source));
    // TimeZone is per connection and can't be changed once the configuration is locked, so set the
    // default every connection starts with. Otherwise it is the process's timezone, and e.g.
    // date_trunc('day', ...) would bucket by local days.
    await conn.run("SET GLOBAL TimeZone = 'UTC';");
    const directories = allowedDirectories(source);
    if (directories.length > 0) {
      await conn.run(`SET allowed_directories = [${directories.map(quoteLiteral).join(', ')}];`);
    }
    await conn.run('SET enable_external_access = false;');
    await conn.run('SET lock_configuration = true;');
    // Every query's connection selects the analytics tables' namespace (see openConnection), so
    // check it is there - otherwise the instance would be ready while every query failed
    await conn.run(`USE ${CATALOG}.${SCHEMA};`);
  } catch (e) {
    conn?.closeSync();
    instance.closeSync();
    throw e;
  }
  conn.closeSync();
  return instance;
}

/**
 * Open a connection to a locked instance with the analytics tables as its default schema, so
 * queries can refer to them without qualifying them. (The default schema is per connection.)
 *
 * @param instance - an instance from createLockedInstance
 * @returns the connection, which the caller closes
 */
export async function openConnection(instance: DuckDBInstance): Promise<DuckDBConnection> {
  const conn = await instance.connect();
  try {
    await conn.run(`USE ${CATALOG}.${SCHEMA};`);
  } catch (e) {
    conn.closeSync();
    throw e;
  }
  return conn;
}
