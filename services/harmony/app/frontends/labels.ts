// functions to support labels routes

import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { addLabelsToJobs, deleteLabelsFromJobs } from '../models/label';
import db from '../util/db';
import { isAdminUser } from '../util/edl-api';

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
  const isAdmin = await isAdminUser(req);

  try {
    // for (const jobId of req.body.job) {
    //   req.context.logger.info(`Adding label(s) ${JSON.stringify(req.body.label)} to job ${jobId} for user ${req.user}`);
    //   await db.transaction(async (trx) => {
    //     await addLabelsToJob(trx, jobId, req.user, req.body.label);
    //   });
    // }
    await db.transaction(async (trx) => {
      await addLabelsToJobs(trx, req.body.job, req.user, req.body.label, isAdmin);
    });

    res.status(201);
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
  const isAdmin = await isAdminUser(req);

  try {
    await db.transaction(async (trx) => {
      await deleteLabelsFromJobs(trx, req.body.job, req.user, req.body.label, isAdmin);
    });

    res.status(204);
    res.send();
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}