import { Response, NextFunction } from 'express';
import { configureLogLevel } from '../util/log';
import HarmonyRequest from '../models/harmony-request';
import { keysToLowerCase } from '../util/object';
import { RequestValidationError } from 'app/util/errors';

/**
 * Admin interface for configuring Harmony.
 */

/**
 * Set the log level for the Harmony frontend and backend.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns JSON response indicating the action performed
 */
export async function setLogLevel(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const query = keysToLowerCase(req.query);
  try {
    const queryKeys = Object.keys(query);
    if (!(queryKeys.length === 1) || queryKeys[0] != 'level') {
      throw new RequestValidationError('Must set log level using a single query parameter: level');
    }
    const result = configureLogLevel(query.level.toLowerCase());
    res.json({ result });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}