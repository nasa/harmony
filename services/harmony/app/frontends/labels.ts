// functions to support labels routes

import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { addLabelsToJobs, deleteLabelsFromJobs } from '../models/label';
import db from '../util/db';
import { isAdminUser } from '../util/edl-api';
import { keysToLowerCase } from '../util/object';

/**
 * Express.js handler that adds one or more labels to a job `(PUT /labels)`.
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
    await db.transaction(async (trx) => {
      const lowerCaseBody = keysToLowerCase(req.body);
      console.log(`BODY: ${JSON.stringify(lowerCaseBody)}`);
      await addLabelsToJobs(trx, lowerCaseBody.jobid, req.user, lowerCaseBody.label, isAdmin);
    });

    res.status(201);
    res.send('OK');
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Express.js handler that removes one or more labels from a job `(DELETE /labels)`.
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
      const lowerCaseBody = keysToLowerCase(req.body);
      await deleteLabelsFromJobs(trx, lowerCaseBody.jobid, req.user, lowerCaseBody.label, isAdmin);
    });

    res.status(204);
    res.send();
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}