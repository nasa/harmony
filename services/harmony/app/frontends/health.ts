import { Response, NextFunction } from 'express';
import { isCmrHealthy } from '../util/cmr';
import { isEdlHealthy } from '../util/edl-api';
import HarmonyRequest from '../models/harmony-request';
import { Job } from '../models/job';
import logger from '../util/log';
import RequestContext from '../models/request-context';
import db from '../util/db';

const UP = 'up';
const DOWN = 'down';
const _DEGRADED = 'degraded';

const HEALTHY_MESSAGE = 'Harmony is operating normally.';
const DOWN_MESSAGE = 'Harmony is currently down.';
const _DEGRADED_MESSAGE = 'Harmony is currently degraded.';

export interface DependencyStatus {
  name: String;
  status: String;
  message?: String;
}

interface HealthStatus {
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
  let dbHealthy = true;
  try {
    await Job.getTimeOfMostRecentlyUpdatedJob(db);
  } catch (e) {
    logger.error(e);
    dbHealthy = false;
  }

  if (dbHealthy) {
    return {
      name: 'db',
      status: UP,
    };
  } else {
    return {
      name: 'db',
      status: DOWN,
      message: 'Unable to query the database',
    };
  }
}

/**
 * Returns the health information
 *
 * @param context - the request context
 * @returns a promise resolving to the health check response
 */
async function getGeneralHealth(context: RequestContext): Promise<HealthStatus> {
  const dbHealth = await getDbHealth();

  const { healthy: cmrHealthy, message: cmrMessage } = await isCmrHealthy();
  const cmrHealth = cmrHealthy ? {
    name: 'cmr',
    status: UP,
  } : {
    name: 'cmr',
    status: DOWN,
    message: `CMR is down. ${cmrMessage}`,
  };

  const edlHealthy = await isEdlHealthy(context);
  const edlHealth = edlHealthy ? {
    name: 'edl',
    status: UP,
  } : {
    name: 'edl',
    status: DOWN,
    message: 'Failed to access EDL home page.',
  };

  let health;
  if (dbHealth.status === UP && cmrHealthy && edlHealthy) {
    health = {
      status: UP,
      message: HEALTHY_MESSAGE,
      dependencies: [dbHealth, cmrHealth, edlHealth],
    };
  } else {
    health = {
      status: DOWN,
      message: DOWN_MESSAGE,
      dependencies: [dbHealth, cmrHealth, edlHealth],
    };
  }
  return health;
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
  if (health.status === DOWN) {
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
  if (health.status === DOWN) {
    res.statusCode = 503;
  }
  res.send(health);
}
