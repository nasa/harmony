import Record from './record';
import { Transaction } from '../util/db';

// Limits on what can be saved. The SQL limit matches the analytics query service's (MAX_SQL_LENGTH
// in services/analytics-query/app/query/validate.ts), so anything saved can also be run.
export const MAX_NAME_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 4096;
export const MAX_SQL_LENGTH = 100_000;
const MAX_PARAMETERS_LENGTH = 100_000;

// The chart types and series limit of public/js/analytics/chart.js (CHART_TYPES, MAX_SERIES)
const CHART_TYPES = ['column', 'line'];
const MAX_CHART_SERIES = 8;

// A parameter's saved default value (the same values the analytics query service binds)
export type ParameterDefault = string | number | boolean | null | (string | number | boolean)[];

/**
 * A saved query as returned by the API
 */
export interface AnalyticsQueryForDisplay {
  id: number;
  name: string;
  description: string;
  sql: string;
  parameters: { [name: string]: ParameterDefault };
  chart: object | null;
  owner: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Whether a value is one a parameter can have
 */
function isParameterDefault(value: unknown): boolean {
  const isScalar = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  if (Array.isArray(value)) {
    return value.every((v) => v !== null && isScalar(v));
  }
  return isScalar(value);
}

/**
 * Parse a JSON column, which is null when it was never set
 */
function parseJson<T>(text: string | null): T | null {
  return text ? JSON.parse(text) : null;
}

/**
 * A query saved from the /admin/analytics page, with default values for its parameters. Anyone who
 * can use the page can see and run every saved query, but only its owner (or an admin) can change
 * or delete it.
 */
export default class AnalyticsQuery extends Record {
  static table = 'analytics_queries';

  name: string;

  description: string;

  sql: string;

  // JSON of the parameter defaults, by parameter name (see ParameterDefault)
  parameters: string;

  // JSON describing how to chart the results, or null
  chart: string;

  // The owner
  username: string;

  /**
   * Validates the query
   *
   * @returns a list of validation errors, or null if the query is valid
   */
  validate(): string[] {
    const errors: string[] = [];
    if (typeof this.name !== 'string' || this.name.trim() === '') {
      errors.push('name must be a non-empty string');
    } else if (this.name.length > MAX_NAME_LENGTH) {
      errors.push(`name must be at most ${MAX_NAME_LENGTH} characters`);
    }
    if (this.description && (typeof this.description !== 'string' || this.description.length > MAX_DESCRIPTION_LENGTH)) {
      errors.push(`description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`);
    }
    if (typeof this.sql !== 'string' || this.sql.trim() === '') {
      errors.push('sql must be a non-empty string');
    } else if (this.sql.length > MAX_SQL_LENGTH) {
      errors.push(`sql must be at most ${MAX_SQL_LENGTH} characters`);
    }
    if (this.parameters && this.parameters.length > MAX_PARAMETERS_LENGTH) {
      errors.push('parameters are too large');
    }
    return errors.length > 0 ? errors : null;
  }

  /**
   * Set the parameter defaults
   *
   * @param parameters - the default value for each parameter, by name
   * @throws TypeError if they aren't an object of parameter values
   */
  setParameters(parameters: unknown): void {
    if (parameters === undefined || parameters === null) {
      this.parameters = null;
      return;
    }
    if (typeof parameters !== 'object' || Array.isArray(parameters)
      || !Object.values(parameters).every(isParameterDefault)) {
      throw new TypeError('parameters must be an object mapping parameter names to strings, numbers, booleans, '
        + 'nulls, or lists of them');
    }
    this.parameters = JSON.stringify(parameters);
  }

  /**
   * Set how to chart the query's results (see public/js/analytics/chart.js)
   *
   * @param chart - \{ type: 'column' | 'line', x: column, y: [columns], series: column | null \},
   * or null for no chart
   * @throws TypeError if it isn't a chart spec
   */
  setChart(chart: unknown): void {
    if (chart === undefined || chart === null) {
      this.chart = null;
      return;
    }
    const spec = chart as { type?: unknown, x?: unknown, y?: unknown, series?: unknown };
    const isName = (v: unknown): boolean => typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME_LENGTH;
    if (typeof chart !== 'object' || Array.isArray(chart)
      || !CHART_TYPES.includes(spec.type as string)
      || !isName(spec.x)
      || !Array.isArray(spec.y) || spec.y.length === 0 || spec.y.length > MAX_CHART_SERIES || !spec.y.every(isName)
      || !(spec.series === undefined || spec.series === null || isName(spec.series))) {
      throw new TypeError(`chart must be null or { type: ${CHART_TYPES.join(' | ')}, x: column, y: [up to `
        + `${MAX_CHART_SERIES} columns], series: column or null }`);
    }
    this.chart = JSON.stringify({ type: spec.type, x: spec.x, y: spec.y, series: spec.series ?? null });
  }

  /**
   * Whether a user may change or delete this query
   *
   * @param username - the user
   * @param isAdmin - whether the user is an admin
   */
  canBeChangedBy(username: string, isAdmin: boolean): boolean {
    return isAdmin || this.username === username;
  }

  /**
   * Get the query as the API returns it
   */
  serialize(): AnalyticsQueryForDisplay {
    return {
      id: Number(this.id),
      name: this.name,
      description: this.description ?? '',
      sql: this.sql,
      parameters: parseJson(this.parameters) ?? {},
      chart: parseJson(this.chart),
      owner: this.username,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Validates and saves the query (see Record.save)
   *
   * @param transaction - The transaction to use for saving the record
   * @param fields - The fields to save to the database, defaults to this
   */
  async save(transaction: Transaction, fields: Partial<AnalyticsQuery> = this): Promise<void> {
    await super.save(transaction, fields);
    // On Postgres the inserted id comes back as { id }
    const id = this.id as unknown;
    if (id && typeof id === 'object' && 'id' in id) {
      this.id = Number((id as { id: number }).id);
    }
  }
}

/**
 * Get every saved query, most recently changed first
 *
 * @param tx - The database transaction
 * @returns the queries
 */
export async function getAnalyticsQueries(tx: Transaction): Promise<AnalyticsQuery[]> {
  const rows = await tx(AnalyticsQuery.table).select().orderBy('updatedAt', 'desc').orderBy('id', 'desc');
  return rows.map((row) => new AnalyticsQuery(row));
}

/**
 * Get a saved query
 *
 * @param tx - The database transaction
 * @param id - The query's id
 * @returns the query, or undefined if there is none with that id
 */
export async function getAnalyticsQueryById(tx: Transaction, id: number): Promise<AnalyticsQuery | undefined> {
  const row = await tx(AnalyticsQuery.table).select().where({ id }).first();
  return row ? new AnalyticsQuery(row) : undefined;
}

/**
 * Whether a user already has a saved query with a name
 *
 * @param tx - The database transaction
 * @param username - The user
 * @param name - The name
 * @param exceptId - A query to ignore (the one being renamed)
 * @returns true if they do
 */
export async function nameIsTaken(tx: Transaction, username: string, name: string, exceptId?: number): Promise<boolean> {
  const query = tx(AnalyticsQuery.table).where({ username, name });
  if (exceptId !== undefined) void query.whereNot({ id: exceptId });
  return (await query.first()) !== undefined;
}

/**
 * Delete a saved query
 *
 * @param tx - The database transaction
 * @param id - The query's id
 */
export async function deleteAnalyticsQuery(tx: Transaction, id: number): Promise<void> {
  await tx(AnalyticsQuery.table).where({ id }).delete();
}
