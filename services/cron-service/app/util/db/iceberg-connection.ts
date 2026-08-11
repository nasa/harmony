import { DuckDBConnection } from '@duckdb/node-api';
import env from '../../util/env';

const ministackSql = `
INSTALL aws;
   INSTALL httpfs;
   INSTALL iceberg;
   LOAD aws;
   LOAD httpfs;
   SET TimeZone = 'UTC';

CREATE SECRET ministack_s3 (
     TYPE s3,
     KEY_ID 'ministack_fake_key',
     SECRET 'ministack_fake_secret',
     REGION 'us-east-1',
     ENDPOINT 'localhost:4566', -- Adjust to your MiniStack container port if different
     USE_SSL false
   );
ATTACH 'arn:aws:s3tables:us-west-2:000000000000:bucket/icebeg-tables'
   AS catalog (
     TYPE iceberg,
     ENDPOINT 'http://localhost:4566/iceberg',
     AUTHORIZATION_TYPE 'none'
   );`;
   
const awsSql = `
INSTALL aws;
   INSTALL httpfs;
   INSTALL iceberg;
   LOAD aws;
   LOAD httpfs;
   SET TimeZone = 'UTC';

CREATE SECRET (TYPE s3, PROVIDER credential_chain);
ATTACH '${env.s3TableBucketArn}' AS catalog (
   TYPE iceberg,
   ENDPOINT_TYPE s3_tables
);`;

/**
 * Set up DuckDb connection configuration
 * @param conn - DuckDB connection
 */
export async function initDbConnection(conn: DuckDBConnection): Promise<void> {
  let sql = awsSql;
  if (env.useLocalstack) {
    sql = ministackSql;
  } 
  await conn.run(ministackSql);
}
