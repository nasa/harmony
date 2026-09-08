import { DuckDBConnection } from '@duckdb/node-api';

import env from '../../util/env';

const ministackSql = `
INSTALL aws;
   INSTALL httpfs;
   INSTALL iceberg;
   LOAD aws;
   LOAD httpfs;
   SET TimeZone = 'UTC';

CREATE OR REPLACE SECRET ministack_s3 (
    TYPE s3,
    KEY_ID 'ministack_fake_key',
    SECRET 'ministack_fake_secret',
    REGION '${env.awsDefaultRegion}',
    ENDPOINT 'localstack:4566',
    URL_STYLE 'path',
    USE_SSL false
);
ATTACH IF NOT EXISTS '${env.s3TableBucketArn}'
  AS catalog (
    TYPE iceberg,
    ENDPOINT 'http://localstack:4566/iceberg',
    AUTHORIZATION_TYPE 'sigv4',
    SECRET ministack_s3,
    SIGV4_SERVICE 's3tables',
    SIGV4_REGION '${env.awsDefaultRegion}',
    ACCESS_DELEGATION_MODE 'none'
  );`;

const awsSql = `
INSTALL aws;
   INSTALL httpfs;
   INSTALL iceberg;
   LOAD aws;
   LOAD httpfs;
   SET TimeZone = 'UTC';

CREATE OR REPLACE SECRET (TYPE s3, PROVIDER credential_chain);
ATTACH IF NOT EXISTS '${env.s3TableBucketArn}' AS catalog (
   TYPE iceberg,
   ENDPOINT_TYPE s3_tables
);`;

/**
 * Set up DuckDb connection configuration. DuckDBInstance.fromCache(':memory:') reuses the
 * same underlying instance across cron ticks, so this must be safe to run more than once
 * against an instance that's already initialized (hence CREATE OR REPLACE / IF NOT EXISTS
 * rather than plain CREATE / ATTACH, which would error out on the second tick).
 * @param conn - DuckDB connection
 */
export async function initDbConnection(conn: DuckDBConnection): Promise<void> {
  let sql = awsSql;
  if (env.useLocalstack) {
    sql = ministackSql;
  }
  await conn.run(sql);
}
