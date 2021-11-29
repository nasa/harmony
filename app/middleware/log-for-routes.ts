import HarmonyRequest from '../models/harmony-request';
import { Response, NextFunction, RequestHandler } from 'express';

/**
 * Log a string using middleware.
 *
 * @param message - The message to log.
 * @param listType - Specify whether the pathList param is an 'allow' or 'deny' list
 * (default is 'deny').
 * @param pathList - List of route path patterns to check whether the message should be logged.
 * Leave blank if the message should be logged for all paths.
 * @param logLevel - The log level to use when logging the message. Defaults to info.
 */
export default function logForRoutes(message: string, listType: 'allow' | 'deny' = 'deny', pathList: RegExp[] = [], logLevel = 'info'): RequestHandler {
  return (req: HarmonyRequest, res: Response, next: NextFunction): void => {
    if (!pathList.length) {
      req.context.logger.log(logLevel, message);
      return next();
    }
    const matchFound = pathList.some((p) => req.path.match(p));
    if ((listType === 'deny' && !matchFound) || (listType === 'allow' && matchFound)) {
      req.context.logger.log(logLevel, message);
      return next();
    }
    return next();
  };
}
