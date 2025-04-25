import { Response, NextFunction } from 'express';
import { getCmrHealth } from '../util/cmr';
import { isEdlHealthy } from '../util/edl-api';
import HarmonyRequest from '../models/harmony-request';
import { Job } from '../models/job';
import logger from '../util/log';
import RequestContext from '../models/request-context';
import db from '../util/db';

export enum HealthStatus {
  UP = 'up',
  DOWN = 'down',
}

const HEALTHY_MESSAGE = 'Harmony is operating normally.';
const DOWN_MESSAGE = 'Harmony is currently down.';

interface DependencyStatus {
  name: String;
  status: String;
  message?: String;
}

interface HealthInfo {
  status: String;
  message?: String;
  dependencies: DependencyStatus[];
}

/**
 * Returns the db health information
 *
 * @returns a promise resolving to the DependencyStatus of database
 */
async function getDbHealth(): Promise<DependencyStatus> {
  try {
    await Job.getTimeOfMostRecentlyUpdatedJob(db);
    return { name: 'db', status: HealthStatus.UP };
  } catch (e) {
    logger.error(e);
    return { name: 'db', status: HealthStatus.DOWN, message: 'Unable to query the database' };
  }
}

/**
 * Returns the health information
 *
 * @param context - the request context
 * @returns a promise resolving to the health check response
 */
async function getGeneralHealth(context: RequestContext): Promise<HealthInfo> {
  const [dbHealth, cmrResult, edlHealthy] = await Promise.all([
    getDbHealth(),
    getCmrHealth(),
    isEdlHealthy(context),
  ]);

  const { healthy: cmrHealthy, message: cmrMessage } = cmrResult;
  const cmrHealth = cmrHealthy
    ? { name: 'cmr', status: HealthStatus.UP }
    : { name: 'cmr', status: HealthStatus.DOWN, message: cmrMessage };

  const edlHealth = edlHealthy
    ? { name: 'edl', status: HealthStatus.UP }
    : { name: 'edl', status: HealthStatus.DOWN, message: 'Failed to access EDL home page.' };

  const allHealthy = dbHealth.status === HealthStatus.UP && cmrHealthy && edlHealthy;

  return {
    status: allHealthy ? HealthStatus.UP : HealthStatus.DOWN,
    message: allHealthy ? HEALTHY_MESSAGE : DOWN_MESSAGE,
    dependencies: [dbHealth, cmrHealth, edlHealth],
  };
}

/**
 * Express.js handler that returns the admin view of the health of the harmony system
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function getAdminHealth(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  const health = await getGeneralHealth(req.context);
  if (health.status === HealthStatus.DOWN) {
    res.statusCode = 503;
  }
  res.send(health);
}

/**
 * Express.js handler that returns the public health of the harmony system
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 */
export async function getHealth(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  const health = await getGeneralHealth(req.context);
  if (health.status === HealthStatus.DOWN) {
    res.statusCode = 503;
  }
  res.send(health);
}
