// functions to support labels routes

import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { addLabelsToJob, deleteLabelsFromJob } from '../models/label';
import db from '../util/db';

/**
 * Express.js handler that adds one or more labels to a job `(POST /labels/{jobID}/add)`.
 * Currently only the job owner can add labels (no admin access).
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function addJobLabels(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    req.context.logger.info('BODY:');
    req.context.logger.info(`${JSON.stringify(req.body, null, 2)}`);
    for (const jobId of req.body.job) {
      req.context.logger.info(`Adding label(s) ${JSON.stringify(req.body.label)} to job ${jobId} for user ${req.user}`);
      await db.transaction(async (trx) => {
        await addLabelsToJob(trx, jobId, req.user, req.body.label);
      });
    }

    res.status(200);
    res.send('OK');
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Express.js handler that removes one or more labels from a job `(POST /labels/{jobID}/delete)`.
 * Currently only the job owner can add labels (no admin access).
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function deleteJobLabels(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    req.context.logger.info(`Adding label ${req.body.label} to job ${req.params.jobID} for user ${req.user}`);
    await db.transaction(async (trx) => {
      await deleteLabelsFromJob(trx, req.params.jobID, req.user, req.body.label);
    });

    res.status(200);
    res.send('OK');
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}