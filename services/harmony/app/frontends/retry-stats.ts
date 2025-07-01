import { NextFunction, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';
import { getRetryCounts } from '../models/work-item';
import db from '../util/db';
import { RequestValidationError } from '../util/errors';
import { keysToLowerCase } from '../util/object';

const DEFAULT_MINUTES = 60;

/**
 * Express.js handler that returns retry statistics for harmony work items,
 * responding with JSON by default or HTML if requested.
 */
export async function getRetryStatistics(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const keys = keysToLowerCase(req.query);

  let numMinutes: number;

  if (keys.numminutes != null) {
    const parsed = Number(keys.numminutes);
    if (Number.isInteger(parsed)) {
      numMinutes = parsed;
    } else {
      numMinutes = NaN;
    }
  } else {
    numMinutes = DEFAULT_MINUTES;
  }

  req.context.logger.info(`Retry statistics requested by user ${req.user}`);

  try {
    if (isNaN(numMinutes) || numMinutes <= 0) {
      throw (new RequestValidationError('numMinutes must be a positive integer'));
    }
    const rawCounts = await getRetryCounts(db, numMinutes);

    const totalWorkItems = Object.values(rawCounts).reduce((sum, v) => sum + v, 0);
    const retriedWorkItems = Object.entries(rawCounts)
      .filter(([k]) => Number(k) > 0)
      .reduce((sum, [, v]) => sum + v, 0);
    const totalRetries = Object.entries(rawCounts)
      .reduce((sum, [k, v]) => sum + (Number(k) * v), 0);

    const percentSuccessful = totalWorkItems === 0 ? 0 : (rawCounts[0] || 0) / totalWorkItems * 100;
    const percentRetried = totalWorkItems === 0 ? 0 : retriedWorkItems / totalWorkItems * 100;

    const countsObj = rawCounts;
    const countsArray = Object.entries(rawCounts)
      .map(([k, v]) => ({ retryCount: k, count: v }))
      .sort((a, b) => Number(a.retryCount) - Number(b.retryCount));

    const result = {
      numMinutes,
      counts: countsObj,
      totalWorkItems,
      totalRetries,
      percentSuccessful: `${percentSuccessful.toFixed(1)}%`,
      percentRetried: `${percentRetried.toFixed(1)}%`,
    };

    // Detect if client wants HTML explicitly - by default we will return JSON
    const acceptsHtml = req.accepts(['json', 'html']) === 'html';

    if (acceptsHtml) {
      res.render('retry-stats', {
        numMinutes,
        counts: countsArray,
        totalWorkItems,
        totalRetries,
        percentSuccessful: percentSuccessful.toFixed(1),
        percentRetried: percentRetried.toFixed(1),
      });
    } else {
      res.json(result);
    }

  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

