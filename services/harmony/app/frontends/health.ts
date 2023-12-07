import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { Job } from '../models/job';
import logger from '../util/log';
import db, { Transaction } from '../util/db';

const UP = 'up';
const DOWN = 'down';
const _DEGRADED = 'degraded';

const HEALTHY_MESSAGE = 'Harmony is operating normally.';
const DOWN_MESSAGE = 'Harmony is currently down.';
const _DEGRADED_MESSAGE = 'Harmony is currently degraded.';

interface ComponentStatus {
  name: String;
  status: String;
  message?: String;
}

interface HealthStatus {
  status: String;
  message?: String;
  components: ComponentStatus[];

}

/**
 * Returns the health information
 *
 * @param tx - the database transaction
 * @returns a promise resolving to the health check response
 */
async function getGeneralHealth(tx: Transaction): Promise<HealthStatus> {
  let dbHealthy = true;
  try {
    await Job.getTimeOfMostRecentlyUpdatedJob(tx);
  } catch (e) {
    logger.error(e);
    dbHealthy = false;
  }

  let health;
  if (dbHealthy) {
    health = {
      status: UP,
      message: HEALTHY_MESSAGE,
      components: [{
        name: 'db',
        status: UP,
      },
      ],
    };
  } else {
    health = {
      status: DOWN,
      message: DOWN_MESSAGE,
      components: [{
        name: 'db',
        status: DOWN,
        message: 'Unable to query the database',
      },
      ],
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
  _req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  const health = await getGeneralHealth(db);
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
  _req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  const health = await getGeneralHealth(db);
  if (health.status === DOWN) {
    res.statusCode = 503;
  }
  res.send(health);
}
