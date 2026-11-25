import { DuckDBConnection } from '@duckdb/node-api';

import { CATALOG, SCHEMA } from './catalog';
import { ColumnInfo } from './validate';

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

export interface SchemaInfo {
  tables: TableInfo[];
  // Problems with the tables' definitions that will affect queries
  warnings: string[];
  loadedAt: string;
}

// Every *_at column is a timestamp. Postgres timestamps are written as timestamptz (see
// bin/create-iceberg-tables), and date functions/time-series charts need them to be.
const TIMESTAMP_COLUMN = /_at$/;
const TIMESTAMPTZ = 'TIMESTAMP WITH TIME ZONE';

const quoteIdentifier = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/**
 * Read the analytics tables and their columns
 *
 * @param conn - a connection from openConnection
 * @returns the tables, sorted by name, and any warnings about their definitions
 */
export async function loadSchema(conn: DuckDBConnection): Promise<SchemaInfo> {
  const tablesReader = await conn.runAndReadAll(`
    SELECT table_name FROM duckdb_tables()
    WHERE database_name = '${CATALOG}' AND schema_name = '${SCHEMA}'
    ORDER BY table_name`);
  const tables: TableInfo[] = [];
  const warnings: string[] = [];
  for (const { table_name: tableName } of tablesReader.getRowObjectsJson()) {
    const name = String(tableName);
    // Not duckdb_columns(): the Iceberg catalog only loads a table's columns when a query uses the
    // table, and until then lists a single placeholder column ("__", type UNKNOWN). DESCRIBE loads it.
    const reader = await conn.runAndReadAll(`DESCRIBE ${CATALOG}.${SCHEMA}.${quoteIdentifier(name)}`);
    const columns = reader.getRowObjectsJson().map((row) => ({ name: String(row.column_name), type: String(row.column_type) }));
    tables.push({ name, columns });
    for (const column of columns) {
      if (TIMESTAMP_COLUMN.test(column.name) && column.type !== TIMESTAMPTZ) {
        warnings.push(`${name}.${column.name} is ${column.type}, not ${TIMESTAMPTZ}: cast it `
          + `(${column.name}::TIMESTAMPTZ) to use it as a timestamp`);
      }
    }
  }
  return { tables, warnings, loadedAt: new Date().toISOString() };
}

/**
 * Caches the schema for a while, since the tables only change when the analytics cron job runs
 */
export class SchemaCache {
  private schema: SchemaInfo | null = null;

  private loadedAtMs = 0;

  // Increases with every clear(), so a load that started before one isn't cached after it
  private generation = 0;

  /**
   * @param ttlSeconds - how long to keep a loaded schema
   */
  constructor(private ttlSeconds: number) {}

  /**
   * Get the schema, loading it if it isn't cached or has expired
   *
   * @param load - loads the schema
   * @returns the schema
   */
  async get(load: () => Promise<SchemaInfo>): Promise<SchemaInfo> {
    if (!this.schema || Date.now() - this.loadedAtMs > this.ttlSeconds * 1000) {
      const { generation } = this;
      const schema = await load();
      // Cleared while loading (e.g. the instance was recreated): return it, but load afresh next time
      if (generation !== this.generation) return schema;
      this.schema = schema;
      this.loadedAtMs = Date.now();
    }
    return this.schema;
  }

  /**
   * Forget the cached schema, e.g. when the instance is recreated
   */
  clear(): void {
    this.schema = null;
    this.generation += 1;
  }
}

/**
 * Get the lower-cased names of the queryable tables
 */
export function tableNames(schema: SchemaInfo): Set<string> {
  return new Set(schema.tables.map((t) => t.name.toLowerCase()));
}
