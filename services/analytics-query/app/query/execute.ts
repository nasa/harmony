import {
  BIGINT, BOOLEAN, DOUBLE, DuckDBConnection, DuckDBListType, DuckDBPreparedStatement, DuckDBResultReader,
  DuckDBTimestampTZValue, DuckDBType, DuckDBTypeId, LIST, listValue, VARCHAR,
} from '@duckdb/node-api';

import { ColumnInfo, preparedParameters } from './validate';
import { QueryProblem, QueryTimeoutError, RequestValidationError } from '../util/errors';

type ScalarValue = string | number | boolean;
// A parameter value as it arrives in a request
export type ParameterValue = ScalarValue | null | ScalarValue[];

export interface QueryLimits {
  maxRows: number;
  timeoutMs: number;
}

export interface QueryResult {
  columns: ColumnInfo[];
  // One array of values per row, in column order (rows as objects would lose any column whose
  // name repeats an earlier one's, e.g. `SELECT a.id, b.id`)
  rows: unknown[][];
  rowCount: number;
  // Whether there were more than limits.maxRows rows (only the first maxRows are returned)
  truncated: boolean;
  durationMs: number;
}

const INTEGER_TYPES = new Set([
  DuckDBTypeId.TINYINT, DuckDBTypeId.SMALLINT, DuckDBTypeId.INTEGER, DuckDBTypeId.BIGINT,
  DuckDBTypeId.UTINYINT, DuckDBTypeId.USMALLINT, DuckDBTypeId.UINTEGER, DuckDBTypeId.UBIGINT,
  DuckDBTypeId.HUGEINT, DuckDBTypeId.UHUGEINT,
]);

// Types the JSON conversion gives as strings (since they can exceed a JS number), which are
// returned as numbers when they fit
const NUMERIC_STRING_TYPES = new Set([
  DuckDBTypeId.BIGINT, DuckDBTypeId.UBIGINT, DuckDBTypeId.HUGEINT, DuckDBTypeId.UHUGEINT, DuckDBTypeId.DECIMAL,
]);

/**
 * Get the JS type of every element of an array, or null if they aren't all the same
 */
function elementType(values: unknown[]): string | null {
  const types = new Set(values.map((v) => typeof v));
  return types.size === 1 ? [...types][0] : null;
}

/**
 * Bind one parameter value. Values are bound as the closest DuckDB type to their JS type (strings
 * as VARCHAR, numbers as BIGINT or DOUBLE) and DuckDB casts them to the type it inferred for the
 * parameter, so e.g. an ISO string binds to a TIMESTAMPTZ parameter, and an invalid one fails with
 * DuckDB's conversion error when the query runs.
 *
 * @param prepared - the prepared statement
 * @param index - the parameter's index
 * @param name - the parameter's name
 * @param type - the type DuckDB inferred for the parameter
 * @param value - the value from the request
 * @returns a problem with the value, or null if it was bound
 */
function bindParameter(prepared: DuckDBPreparedStatement, index: number, name: string, type: DuckDBType,
  value: ParameterValue): QueryProblem | null {
  const problem = (message: string): QueryProblem => ({ message: `Parameter $${name}: ${message}`, position: null });
  const isInteger = INTEGER_TYPES.has(type.typeId);

  if (value === null) {
    prepared.bindNull(index);
  } else if (Array.isArray(value)) {
    if (type.typeId !== DuckDBTypeId.LIST) {
      return problem(`expected a single ${type} value, not a list`);
    }
    const { valueType } = type as DuckDBListType;
    const kind = value.length === 0 ? 'string' : elementType(value);
    if (kind === 'number' && INTEGER_TYPES.has(valueType.typeId)) {
      // A number past Number.MAX_SAFE_INTEGER may not be the one that was meant; larger values can
      // be given exactly as strings, which DuckDB casts
      if (!value.every((v) => Number.isSafeInteger(v))) {
        return problem(`expected whole numbers for ${type} (as strings past ${Number.MAX_SAFE_INTEGER})`);
      }
      prepared.bindValue(index, listValue(value.map((v) => BigInt(v as number))), LIST(BIGINT));
    } else if (kind === 'number') {
      prepared.bindValue(index, listValue(value), LIST(DOUBLE));
    } else if (kind === 'string') {
      prepared.bindValue(index, listValue(value), LIST(VARCHAR));
    } else if (kind === 'boolean') {
      prepared.bindValue(index, listValue(value), LIST(BOOLEAN));
    } else {
      return problem('list values must all be strings, all numbers, or all booleans');
    }
  } else if (typeof value === 'boolean') {
    prepared.bindBoolean(index, value);
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) return problem('expected a finite number');
    if (isInteger) {
      // DuckDB would round a fraction to the nearest integer rather than reject it. Past
      // Number.MAX_SAFE_INTEGER a number may not be the one that was meant; give those as strings.
      if (!Number.isInteger(value)) return problem(`expected a whole number for ${type}`);
      if (!Number.isSafeInteger(value)) {
        return problem(`${value} is too large to be exact as a number - give it as a string`);
      }
      prepared.bindBigInt(index, BigInt(value));
    } else {
      prepared.bindDouble(index, value);
    }
  } else if (typeof value === 'string') {
    prepared.bindVarchar(index, value);
  } else {
    return problem('expected a string, number, boolean, null, or list of them');
  }
  return null;
}

/**
 * Bind the request's parameter values to a prepared statement
 *
 * @throws RequestValidationError if a parameter is missing, unknown, or has an unusable value
 */
function bindParameters(prepared: DuckDBPreparedStatement, values: Record<string, ParameterValue>): void {
  const { parameters, problems } = preparedParameters(prepared);
  const names = new Set(parameters.map((p) => p.name));
  for (const name of Object.keys(values)) {
    if (!names.has(name)) problems.push({ message: `The query has no parameter $${name}`, position: null });
  }
  for (let i = 1; i <= prepared.parameterCount && problems.length === 0; i++) {
    const name = prepared.parameterName(i);
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      problems.push({ message: `No value was given for parameter $${name}`, position: null });
    } else {
      const problem = bindParameter(prepared, i, name, prepared.parameterType(i), values[name]);
      if (problem) problems.push(problem);
    }
  }
  if (problems.length > 0) {
    throw new RequestValidationError('Invalid query parameters', problems);
  }
}

// JS Dates only reach 8.64e15 ms either side of 1970 (about 275,000 years); DuckDB timestamps go
// further. The Gregorian calendar repeats every 400 years, which is this many ms.
const MAX_DATE_MS = 8_640_000_000_000_000n;
const GREGORIAN_CYCLE_MS = 146_097n * 86_400_000n;

/**
 * Format a time as ISO 8601 UTC, to the millisecond. A time outside the JS Date range is shifted
 * by whole 400-year cycles into it and its year put back, giving an extended year (+300000-...).
 */
function isoFromMillis(millis: bigint): string {
  if (millis >= -MAX_DATE_MS && millis <= MAX_DATE_MS) {
    return new Date(Number(millis)).toISOString();
  }
  const cycles = (millis >= 0n ? millis : millis - GREGORIAN_CYCLE_MS + 1n) / GREGORIAN_CYCLE_MS; // floor
  // Now from 1970 to 2369, so the year is the first four characters
  const shifted = new Date(Number(millis - cycles * GREGORIAN_CYCLE_MS)).toISOString();
  const year = Number(shifted.slice(0, 4)) + Number(cycles) * 400;
  return `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}${shifted.slice(4)}`;
}

/**
 * Format a TIMESTAMPTZ as an ISO 8601 UTC string. The JSON conversion would render it in the
 * process's local timezone, whatever DuckDB's TimeZone setting is.
 */
function timestampTzToIso(value: unknown): unknown {
  if (!(value instanceof DuckDBTimestampTZValue) || !value.isFinite) {
    return value === null ? null : String(value);
  }
  const { micros } = value;
  const millis = micros >= 0n ? micros / 1000n : (micros - 999n) / 1000n; // floor, for dates before 1970
  const extraMicros = Number(((micros % 1000n) + 1000n) % 1000n);
  const iso = isoFromMillis(millis);
  return extraMicros === 0 ? iso : iso.replace('Z', `${String(extraMicros).padStart(3, '0')}Z`);
}

/**
 * Whether a number is exactly the decimal it was converted from, e.g. 1.25 for '1.250' but not
 * 12345678901234567.89 for '12345678901234567.89' (it rounds to ...68)
 *
 * @param text - the decimal, as DuckDB gives it (no exponent)
 * @param n - Number(text)
 */
function decimalIsExact(text: string, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  // The shortest text that converts back to n. One with an exponent (very large or small) is
  // treated as inexact, which at worst returns an exact value as a string.
  const shortest = String(n);
  if (shortest.includes('e')) return false;
  const normalize = (s: string): string => {
    const [whole, fraction = ''] = s.replace(/^-/, '').split('.');
    const digits = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`.replace(/\.$/, '');
    return s.startsWith('-') && digits !== '0' ? `-${digits}` : digits;
  };
  return normalize(text) === normalize(shortest);
}

/**
 * Get JSON-safe rows from a result, with numbers that fit returned as numbers and timestamps as
 * ISO UTC strings
 */
function resultRows(reader: DuckDBResultReader, maxRows: number): unknown[][] {
  const typeIds = reader.columnTypes().map((t) => t.typeId);
  const rows = reader.getRowsJson().slice(0, maxRows) as unknown[][];
  const timestampColumns = typeIds.flatMap((id, i) => (id === DuckDBTypeId.TIMESTAMP_TZ ? [i] : []));
  const rawRows = timestampColumns.length > 0 ? reader.getRows() : [];

  rows.forEach((row, r) => {
    typeIds.forEach((id, c) => {
      if (id === DuckDBTypeId.TIMESTAMP_TZ) {
        row[c] = timestampTzToIso(rawRows[r][c]);
      } else if (NUMERIC_STRING_TYPES.has(id) && typeof row[c] === 'string') {
        const n = Number(row[c]);
        const fits = id === DuckDBTypeId.DECIMAL ? decimalIsExact(row[c] as string, n) : Number.isSafeInteger(n);
        if (fits) row[c] = n;
      }
    });
  });
  return rows;
}

/**
 * A time limit for everything done on one connection: once it passes, whatever is running on the
 * connection is interrupted
 */
export class Deadline {
  private timedOut = false;

  private timer: NodeJS.Timeout;

  constructor(conn: DuckDBConnection, readonly timeoutMs: number) {
    this.timer = setTimeout(() => {
      this.timedOut = true;
      conn.interrupt();
    }, timeoutMs);
  }

  get expired(): boolean {
    return this.timedOut;
  }

  /**
   * @throws QueryTimeoutError if the time limit has passed
   */
  check(): void {
    if (this.timedOut) throw new QueryTimeoutError(this.timeoutMs);
  }

  clear(): void {
    clearTimeout(this.timer);
  }
}

/**
 * Run a function with a time limit for everything it does on a connection. It is still waited for
 * once the limit passes (it fails when its query is interrupted), so the caller only releases the
 * connection once DuckDB has stopped using it.
 *
 * @param conn - the connection
 * @param timeoutMs - the time limit
 * @param fn - the function, given the deadline to pass on (e.g. to executeQuery)
 * @returns what the function returns
 * @throws QueryTimeoutError if it fails after the time limit (whatever it failed with)
 */
export async function withDeadline<T>(conn: DuckDBConnection, timeoutMs: number,
  fn: (deadline: Deadline) => Promise<T>): Promise<T> {
  const deadline = new Deadline(conn, timeoutMs);
  try {
    return await fn(deadline);
  } catch (e) {
    // An interrupted query fails with DuckDB's own error, whichever step it was in
    if (deadline.expired) throw new QueryTimeoutError(timeoutMs);
    throw e;
  } finally {
    deadline.clear();
  }
}

/**
 * Run a query that has already been validated (see validateSql)
 *
 * @param conn - the connection to run it on, which is interrupted if the query times out
 * @param sql - the query
 * @param values - the value for each of the query's parameters, by name (without the $)
 * @param limits - the row cap, and the time limit if no deadline is given
 * @param deadline - the time limit already running for the request (e.g. since it was validated),
 *   or none to give the query limits.timeoutMs from now
 * @returns the result
 * @throws RequestValidationError if the parameters are wrong or the query fails
 * @throws QueryTimeoutError if the query runs past the time limit
 */
export async function executeQuery(conn: DuckDBConnection, sql: string, values: Record<string, ParameterValue>,
  limits: QueryLimits, deadline?: Deadline): Promise<QueryResult> {
  if (!deadline) {
    return withDeadline(conn, limits.timeoutMs, (d) => executeQuery(conn, sql, values, limits, d));
  }
  const startMs = Date.now();
  const prepared = await conn.prepare(sql);
  try {
    bindParameters(prepared, values);

    let reader: DuckDBResultReader;
    try {
      // The time may have run out between statements, when there was nothing to interrupt
      deadline.check();
      // Streaming stops reading once one row past the cap is in, rather than materializing the
      // whole result. (It reads whole chunks, so may get a little further.)
      reader = await prepared.streamAndReadUntil(limits.maxRows + 1);
    } catch (e) {
      if (deadline.expired) throw new QueryTimeoutError(deadline.timeoutMs);
      // e.g. a parameter value that can't be converted to the parameter's type
      throw new RequestValidationError(e.message.replace(/\n\nLINE \d+:[\s\S]*$/, '').trim());
    }

    const columns = reader.columnNames().map((name, i) => ({ name, type: reader.columnType(i).toString() }));
    const rows = resultRows(reader, limits.maxRows);
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: reader.currentRowCount > limits.maxRows,
      durationMs: Date.now() - startMs,
    };
  } finally {
    prepared.destroySync();
  }
}
