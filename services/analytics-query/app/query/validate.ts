import { DuckDBConnection, DuckDBPreparedStatement } from '@duckdb/node-api';

import { CATALOG, SCHEMA } from './catalog';
import { QueryProblem } from '../util/errors';

// Longer queries are rejected before they are parsed
export const MAX_SQL_LENGTH = 100_000;

// Table functions that only compute over their arguments (no files, network, or catalog state)
const ALLOWED_TABLE_FUNCTIONS = new Set(['range', 'generate_series', 'unnest', 'json_each', 'json_tree']);

// Scalar functions/macros that expose settings or session state, or only exist to waste time
const DENIED_FUNCTIONS = new Set([
  'current_setting', 'current_query', 'sleep_ms', 'pg_sleep', 'getenv',
  'has_database_privilege', 'has_schema_privilege', 'pg_conf_load_time',
]);

// The TableRef types (FROM-clause items) the validator understands. Anything else is rejected, so
// a TableRef kind added by a future DuckDB version fails closed instead of being ignored.
const KNOWN_TABLE_REFS = new Set(['BASE_TABLE', 'TABLE_FUNCTION', 'JOIN', 'SUBQUERY', 'EMPTY',
  'EXPRESSION_LIST', 'PIVOT']);

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface ParameterInfo {
  name: string;
  type: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: QueryProblem[];
  // The query's output columns and its parameters, when it is valid
  columns: ColumnInfo[];
  parameters: ParameterInfo[];
}

// A node of the parse tree json_serialize_sql returns
type ParseNode = { [key: string]: unknown };

const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Get the character offset a DuckDB binder/catalog error points at, from the caret line it appends
 * to the message (DuckDB only reports a structured position for parser errors)
 *
 * @param sql - the query
 * @param message - the error message
 * @returns the offset, or null if the message doesn't point at one
 */
export function caretOffset(sql: string, message: string): number | null {
  const match = message.match(/\nLINE (\d+): (.*)\n( *)\^/);
  if (!match) return null;
  const [, lineText, shown, pad] = match;
  const lineNumber = Number(lineText);
  const lines = sql.split('\n');
  const line = lines[lineNumber - 1] ?? '';
  // A long line is shown truncated, with a leading and/or trailing '...'
  const truncatedStart = shown.startsWith('...');
  const shownText = shown.replace(/^\.\.\./, '').replace(/\.\.\.$/, '');
  const startInLine = Math.max(0, line.indexOf(shownText));
  const column = pad.length - `LINE ${lineNumber}: `.length - (truncatedStart ? 3 : 0);
  const lineStart = lines.slice(0, lineNumber - 1).reduce((total, l) => total + l.length + 1, 0);
  return lineStart + startInLine + Math.max(0, column);
}

/**
 * Remove the "LINE n: ..." excerpt DuckDB appends to an error message
 */
function withoutExcerpt(message: string): string {
  return message.replace(/\n\nLINE \d+:[\s\S]*$/, '').trim();
}

/**
 * Walk a parse tree, calling visit on every node
 */
function walk(node: unknown, visit: (n: ParseNode) => void): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit));
  } else if (node && typeof node === 'object') {
    visit(node as ParseNode);
    Object.values(node).forEach((v) => walk(v, visit));
  }
}

/**
 * Check a parse tree against the policy: every table must be an allowed table in the analytics
 * schema or a CTE the query defines, and every function call must be allowed
 *
 * @param ast - the parse tree
 * @param allowedTables - the names of the queryable tables
 * @returns the problems found
 */
function checkPolicy(ast: ParseNode, allowedTables: Set<string>): QueryProblem[] {
  const problems: QueryProblem[] = [];

  const cteNames = new Set<string>();
  walk(ast, (n) => {
    const map = (n.cte_map as { map?: { key: unknown }[] } | undefined)?.map;
    map?.forEach((entry) => cteNames.add(String(entry.key).toLowerCase()));
  });

  walk(ast, (n) => {
    const position = typeof n.query_location === 'number' ? n.query_location : null;
    if ('class' in n) { // an expression
      if (n.class === 'FUNCTION' && DENIED_FUNCTIONS.has(String(n.function_name).toLowerCase())) {
        problems.push({ message: `Function ${n.function_name} is not allowed`, position });
      }
      return;
    }
    const type = String(n.type ?? '');
    if (!('sample' in n) || type.endsWith('_NODE')) return; // not a TableRef

    if (!KNOWN_TABLE_REFS.has(type)) {
      problems.push({ message: `Unsupported FROM clause item ${type}`, position });
    } else if (type === 'BASE_TABLE') {
      const tableName = String(n.table_name);
      const catalog = String(n.catalog_name ?? '').toLowerCase();
      const schema = String(n.schema_name ?? '').toLowerCase();
      const table = tableName.toLowerCase();
      const isCte = !catalog && !schema && cteNames.has(table);
      // `jobs`, `iceberg.jobs` or `catalog.iceberg.jobs` (a two-part name parses as schema.table,
      // so `catalog.jobs` names a schema called catalog and is rejected)
      const inAnalyticsSchema = (catalog === CATALOG || catalog === '') && (schema === SCHEMA || schema === '')
        && allowedTables.has(table);
      if (!isCte && inAnalyticsSchema && tableName !== table) {
        // The Iceberg REST catalog looks table names up case-sensitively (quoted or not), while
        // catalog and schema names aren't. Reject here so a query behaves the same against every
        // catalog, rather than only failing against Iceberg.
        problems.push({ message: `Table names are case-sensitive: use ${table}`, position });
      } else if (!isCte && !inAnalyticsSchema) {
        const name = [n.catalog_name, n.schema_name, n.table_name].filter(Boolean).join('.');
        problems.push({ message: `Table ${name} is not queryable`, position });
      }
    } else if (type === 'TABLE_FUNCTION') {
      const fn = n.function as ParseNode;
      const name = String(fn.function_name);
      if (!ALLOWED_TABLE_FUNCTIONS.has(name.toLowerCase())) {
        const fnPosition = typeof fn.query_location === 'number' ? fn.query_location : position;
        problems.push({ message: `Table function ${name} is not allowed`, position: fnPosition });
      }
    }
  });
  return problems;
}

/**
 * Get a prepared statement's parameters, requiring each to have a type DuckDB can infer (one it
 * can't, e.g. a list passed to unnest, would have nothing to bind a value as)
 *
 * @param prepared - the prepared statement
 * @returns the parameters and any problems with them
 */
export function preparedParameters(prepared: DuckDBPreparedStatement): { parameters: ParameterInfo[], problems: QueryProblem[] } {
  const parameters: ParameterInfo[] = [];
  const problems: QueryProblem[] = [];
  for (let i = 1; i <= prepared.parameterCount; i++) {
    const name = prepared.parameterName(i);
    try {
      parameters.push({ name, type: prepared.parameterType(i).toString() });
    } catch {
      problems.push({
        message: `The type of parameter $${name} can't be inferred, give it one explicitly, e.g. $${name}::VARCHAR`,
        position: null,
      });
    }
  }
  return { parameters, problems };
}

/**
 * Validate a query. A query is accepted only if:
 *   1. DuckDB's own parser accepts it as exactly one SELECT statement (json_serialize_sql only
 *      serializes SELECTs, so DML/DDL/COPY/ATTACH/SET/PRAGMA/INSTALL are all rejected here),
 *   2. every table it references is a queryable analytics table or a CTE it defines,
 *   3. every table function it calls is allowed, and it calls no denied scalar function,
 *   4. it prepares (binds) cleanly, with a type for every parameter, which also gives its output
 *      columns without running it.
 *
 * This is one layer of several, not the security boundary: the connection itself refuses writes
 * and external access (see catalog.ts), and the deployed service's IAM role is read-only.
 *
 * @param conn - a connection from openConnection (the kind the query would run on)
 * @param sql - the query
 * @param allowedTables - the lower-cased names of the queryable tables
 * @returns whether the query is valid, its problems if not, and its columns and parameters if so
 */
export async function validateSql(conn: DuckDBConnection, sql: string, allowedTables: Set<string>,
): Promise<ValidationResult> {
  const invalid = (errors: QueryProblem[]): ValidationResult => ({ valid: false, errors, columns: [], parameters: [] });

  if (sql.trim() === '') {
    return invalid([{ message: 'The query is empty', position: null }]);
  }
  if (sql.length > MAX_SQL_LENGTH) {
    return invalid([{ message: `The query is longer than ${MAX_SQL_LENGTH} characters`, position: null }]);
  }

  const reader = await conn.runAndReadAll(`SELECT json_serialize_sql(${quoteLiteral(sql)}) AS ast`);
  const ast = JSON.parse(String(reader.getRowObjectsJson()[0].ast));
  if (ast.error) {
    // json_serialize_sql's error for anything but a SELECT ("Only SELECT statements can be serialized")
    if (String(ast.error_type).replace(/\s/g, '').toLowerCase() === 'notimplemented') {
      return invalid([{ message: 'Only SELECT queries are allowed', position: null }]);
    }
    return invalid([{ message: ast.error_message, position: ast.position == null ? null : Number(ast.position) }]);
  }
  if (ast.statements.length !== 1) {
    return invalid([{ message: `Exactly one statement is allowed, found ${ast.statements.length}`, position: null }]);
  }

  const problems = checkPolicy(ast, allowedTables);
  if (problems.length > 0) {
    return invalid(problems);
  }

  let prepared: DuckDBPreparedStatement;
  try {
    prepared = await conn.prepare(sql);
  } catch (e) {
    return invalid([{ message: withoutExcerpt(e.message), position: caretOffset(sql, e.message) }]);
  }
  try {
    const { parameters, problems: parameterProblems } = preparedParameters(prepared);
    if (parameterProblems.length > 0) {
      return invalid(parameterProblems);
    }
    const columns: ColumnInfo[] = [];
    for (let i = 0; i < prepared.columnCount; i++) {
      columns.push({ name: prepared.columnName(i), type: prepared.columnType(i).toString() });
    }
    return { valid: true, errors: [], columns, parameters };
  } finally {
    prepared.destroySync();
  }
}
