import { Response } from 'express';

import { sendError } from './analytics';
import AnalyticsDashboard, {
  dashboardNameIsTaken, deleteAnalyticsDashboard, getAnalyticsDashboardById, getAnalyticsDashboards,
} from '../models/analytics-dashboard';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';
import harmonyVersion from '../util/version';

//
// Dashboards: layouts of saved queries' charts and tables, on the Dashboards tab of the
// /admin/analytics page. Like saved queries they are stored in the jobs database and served by
// harmony itself; viewing one runs each panel's query through the analytics query service.
//

/**
 * Express.js handler for the dashboards tab. It is only a shell - it gets everything from the API.
 *
 * @param req - The client request
 * @param res - The client response
 */
export async function getAnalyticsDashboardsPage(req: HarmonyRequest, res: Response): Promise<void> {
  req.context.logger.info(`Analytics dashboards page requested by user ${req.user}`);
  res.render('analytics-dashboards', {
    version: harmonyVersion, username: req.user, isAdmin: !!req.context.isAdminAccess, dashboardsTab: true,
  });
}

/**
 * Get the dashboard a request's :id names
 *
 * @returns the dashboard, or undefined (having responded with a 404) if there is none
 */
async function requestedDashboard(req: HarmonyRequest, res: Response): Promise<AnalyticsDashboard | undefined> {
  const dashboard = /^\d+$/.test(req.params.id) ? await getAnalyticsDashboardById(db, Number(req.params.id)) : undefined;
  if (!dashboard) {
    sendError(res, 404, `There is no dashboard with id ${req.params.id}`);
  }
  return dashboard;
}

/**
 * Set a dashboard's fields from a request body, leaving out any that aren't in it
 *
 * @returns problems with the body
 */
function applyBody(dashboard: AnalyticsDashboard, body: { [key: string]: unknown }): string[] {
  const problems: string[] = [];
  for (const field of ['name', 'description']) {
    if (body[field] === undefined) continue;
    if (field === 'description' && body[field] === null) {
      dashboard.description = null;
    } else if (typeof body[field] !== 'string') {
      problems.push(`${field} must be a string`);
    } else {
      dashboard[field] = field === 'name' ? (body[field] as string).trim() : body[field];
    }
  }
  for (const [field, set] of [
    ['panels', (v: unknown): void => dashboard.setPanels(v)],
    ['parameters', (v: unknown): void => dashboard.setParameters(v)],
  ] as const) {
    if (body[field] === undefined) continue;
    try {
      set(body[field]);
    } catch (e) {
      problems.push(e.message);
    }
  }
  return problems.concat(problems.length === 0 ? dashboard.validate() ?? [] : []);
}

/**
 * Express.js handler that lists the dashboards
 */
export async function listAnalyticsDashboards(req: HarmonyRequest, res: Response): Promise<void> {
  const dashboards = await getAnalyticsDashboards(db);
  res.json({ dashboards: dashboards.map((d) => d.serialize()) });
}

/**
 * Express.js handler that gets one dashboard
 */
export async function getAnalyticsDashboard(req: HarmonyRequest, res: Response): Promise<void> {
  const dashboard = await requestedDashboard(req, res);
  if (dashboard) res.json(dashboard.serialize());
}

/**
 * Express.js handler that saves a new dashboard, owned by the requesting user
 */
export async function createAnalyticsDashboard(req: HarmonyRequest, res: Response): Promise<void> {
  if (!req.is('application/json')) {
    sendError(res, 415, 'The request body must be JSON (Content-Type: application/json)');
    return;
  }
  const dashboard = new AnalyticsDashboard({ username: req.user, panels: '[]' });
  const problems = applyBody(dashboard, req.body ?? {});
  if (problems.length > 0) {
    sendError(res, 400, 'The dashboard could not be saved', problems);
    return;
  }
  await db.transaction(async (tx) => {
    if (await dashboardNameIsTaken(tx, req.user, dashboard.name)) {
      sendError(res, 409, `You already have a dashboard named "${dashboard.name}"`);
      return;
    }
    await dashboard.save(tx);
    req.context.logger.info(`User ${req.user} saved analytics dashboard ${dashboard.id} "${dashboard.name}"`);
    res.status(201).json(dashboard.serialize());
  });
}

/**
 * Express.js handler that changes a dashboard - only its owner or an admin may
 */
export async function updateAnalyticsDashboard(req: HarmonyRequest, res: Response): Promise<void> {
  if (!req.is('application/json')) {
    sendError(res, 415, 'The request body must be JSON (Content-Type: application/json)');
    return;
  }
  const dashboard = await requestedDashboard(req, res);
  if (!dashboard) return;
  if (!dashboard.canBeChangedBy(req.user, !!req.context.isAdminAccess)) {
    sendError(res, 403, `Only ${dashboard.username} (or an admin) can change this dashboard - save it under a new name instead`);
    return;
  }
  const problems = applyBody(dashboard, req.body ?? {});
  if (problems.length > 0) {
    sendError(res, 400, 'The dashboard could not be saved', problems);
    return;
  }
  await db.transaction(async (tx) => {
    if (await dashboardNameIsTaken(tx, dashboard.username, dashboard.name, dashboard.id)) {
      sendError(res, 409, `${dashboard.username} already has a dashboard named "${dashboard.name}"`);
      return;
    }
    const { name, description, panels, parameters } = dashboard;
    await dashboard.save(tx, { name, description, panels, parameters });
    req.context.logger.info(`User ${req.user} updated analytics dashboard ${dashboard.id} "${dashboard.name}"`);
    res.json(dashboard.serialize());
  });
}

/**
 * Express.js handler that deletes a dashboard - only its owner or an admin may. The saved queries
 * it shows are not deleted.
 */
export async function deleteAnalyticsDashboardHandler(req: HarmonyRequest, res: Response): Promise<void> {
  const dashboard = await requestedDashboard(req, res);
  if (!dashboard) return;
  if (!dashboard.canBeChangedBy(req.user, !!req.context.isAdminAccess)) {
    sendError(res, 403, `Only ${dashboard.username} (or an admin) can delete this dashboard`);
    return;
  }
  await deleteAnalyticsDashboard(db, dashboard.id);
  req.context.logger.info(`User ${req.user} deleted analytics dashboard ${dashboard.id} "${dashboard.name}"`);
  res.status(204).end();
}
