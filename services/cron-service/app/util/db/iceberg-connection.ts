import { DuckDBConnection } from '@duckdb/node-api';

/**
 * Set up DuckDb connection configuration
 * @param conn - DuckDB connection
 */
export async function initDbConnection(conn: DuckDBConnection): Promise<void> {
  const sql = `
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
  await conn.run(sql);
}
