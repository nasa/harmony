import {
  isParameterDefault, MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, MAX_ROW_LIMIT, ParameterDefault, parseJson,
} from './analytics-query';
import Record from './record';
import { Transaction } from '../util/db';

// The most panels a dashboard can have. Each panel runs a query when the dashboard is viewed.
export const MAX_PANELS = 24;
const PANEL_DISPLAYS = ['chart', 'table'];
const PANEL_WIDTHS = ['half', 'full'];
const MAX_PARAMETERS_LENGTH = 100_000;

/**
 * One panel of a dashboard: a saved query, shown as its chart or as a table
 */
export interface DashboardPanel {
  queryId: number;
  display: 'chart' | 'table';
  width: 'half' | 'full';
  // The most rows to fetch for the panel, or null to use its query's row limit
  limit: number | null;
}

/**
 * A dashboard as returned by the API
 */
export interface AnalyticsDashboardForDisplay {
  id: number;
  name: string;
  description: string;
  panels: DashboardPanel[];
  parameters: { [name: string]: ParameterDefault };
  owner: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Check one panel from a request, filling in the defaults
 *
 * @param panel - the panel
 * @param index - its position, for the error message
 * @returns the panel
 * @throws TypeError if it isn't a valid panel
 */
function toPanel(panel: unknown, index: number): DashboardPanel {
  const p = panel as { queryId?: unknown, display?: unknown, width?: unknown, limit?: unknown };
  const problem = (what: string): TypeError => new TypeError(`panel ${index + 1}: ${what}`);
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw problem('must be an object');
  if (!Number.isInteger(p.queryId) || (p.queryId as number) < 1) throw problem('queryId must be a saved query id');
  if (p.display !== undefined && !PANEL_DISPLAYS.includes(p.display as string)) {
    throw problem(`display must be ${PANEL_DISPLAYS.join(' or ')}`);
  }
  if (p.width !== undefined && !PANEL_WIDTHS.includes(p.width as string)) {
    throw problem(`width must be ${PANEL_WIDTHS.join(' or ')}`);
  }
  if (p.limit !== undefined && p.limit !== null
    && (!Number.isInteger(p.limit) || (p.limit as number) < 1 || (p.limit as number) > MAX_ROW_LIMIT)) {
    throw problem(`limit must be null or a whole number of rows from 1 to ${MAX_ROW_LIMIT}`);
  }
  return {
    queryId: p.queryId as number,
    display: (p.display ?? 'chart') as DashboardPanel['display'],
    width: (p.width ?? 'half') as DashboardPanel['width'],
    limit: (p.limit ?? null) as number | null,
  };
}

/**
 * A dashboard on the /admin/analytics page: an ordered list of panels, each showing a saved query,
 * and values for the queries' parameters (one value per parameter name, shared by every panel
 * whose query has a parameter of that name). Like saved queries, every user of the page can see
 * every dashboard, and only its owner or an admin can change or delete it.
 */
export default class AnalyticsDashboard extends Record {
  static table = 'analytics_dashboards';

  name: string;

  description: string;

  // JSON of the panels (see DashboardPanel)
  panels: string;

  // JSON of the parameter values, by parameter name
  parameters: string;

  // The owner
  username: string;

  /**
   * Validates the dashboard
   *
   * @returns a list of validation errors, or null if the dashboard is valid
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
    if (typeof this.panels !== 'string') {
      errors.push('panels must be a list of panels');
    }
    if (this.parameters && this.parameters.length > MAX_PARAMETERS_LENGTH) {
      errors.push('parameters are too large');
    }
    return errors.length > 0 ? errors : null;
  }

  /**
   * Set the panels
   *
   * @param panels - the panels, in order
   * @throws TypeError if they aren't a list of up to MAX_PANELS valid panels
   */
  setPanels(panels: unknown): void {
    if (!Array.isArray(panels)) throw new TypeError('panels must be a list of panels');
    if (panels.length > MAX_PANELS) throw new TypeError(`a dashboard can have at most ${MAX_PANELS} panels`);
    this.panels = JSON.stringify(panels.map(toPanel));
  }

  /**
   * Set the parameter values
   *
   * @param parameters - the value for each parameter, by name
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
   * Whether a user may change or delete this dashboard
   *
   * @param username - the user
   * @param isAdmin - whether the user is an admin
   */
  canBeChangedBy(username: string, isAdmin: boolean): boolean {
    return isAdmin || this.username === username;
  }

  /**
   * Get the dashboard as the API returns it
   */
  serialize(): AnalyticsDashboardForDisplay {
    return {
      id: Number(this.id),
      name: this.name,
      description: this.description ?? '',
      panels: parseJson(this.panels) ?? [],
      parameters: parseJson(this.parameters) ?? {},
      owner: this.username,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Validates and saves the dashboard (see Record.save)
   *
   * @param transaction - The transaction to use for saving the record
   * @param fields - The fields to save to the database, defaults to this
   */
  async save(transaction: Transaction, fields: Partial<AnalyticsDashboard> = this): Promise<void> {
    await super.save(transaction, fields);
    // On Postgres the inserted id comes back as { id }
    const id = this.id as unknown;
    if (id && typeof id === 'object' && 'id' in id) {
      this.id = Number((id as { id: number }).id);
    }
  }
}

/**
 * Get every dashboard, most recently changed first
 *
 * @param tx - The database transaction
 * @returns the dashboards
 */
export async function getAnalyticsDashboards(tx: Transaction): Promise<AnalyticsDashboard[]> {
  const rows = await tx(AnalyticsDashboard.table).select().orderBy('updatedAt', 'desc').orderBy('id', 'desc');
  return rows.map((row) => new AnalyticsDashboard(row));
}

/**
 * Get a dashboard
 *
 * @param tx - The database transaction
 * @param id - The dashboard's id
 * @returns the dashboard, or undefined if there is none with that id
 */
export async function getAnalyticsDashboardById(tx: Transaction, id: number): Promise<AnalyticsDashboard | undefined> {
  const row = await tx(AnalyticsDashboard.table).select().where({ id }).first();
  return row ? new AnalyticsDashboard(row) : undefined;
}

/**
 * Whether a user already has a dashboard with a name
 *
 * @param tx - The database transaction
 * @param username - The user
 * @param name - The name
 * @param exceptId - A dashboard to ignore (the one being renamed)
 * @returns true if they do
 */
export async function dashboardNameIsTaken(tx: Transaction, username: string, name: string, exceptId?: number,
): Promise<boolean> {
  const query = tx(AnalyticsDashboard.table).where({ username, name });
  if (exceptId !== undefined) void query.whereNot({ id: exceptId });
  return (await query.first()) !== undefined;
}

/**
 * Delete a dashboard
 *
 * @param tx - The database transaction
 * @param id - The dashboard's id
 */
export async function deleteAnalyticsDashboard(tx: Transaction, id: number): Promise<void> {
  await tx(AnalyticsDashboard.table).where({ id }).delete();
}
