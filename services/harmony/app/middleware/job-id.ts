import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { parseMultiValueParameter } from '../util/parameter-parsing-helpers';
import { keysToLowerCase } from '../../built/services/harmony/app/util/object';

/**
 * Express.js middleware to convert jobId parameter to an array (if needed) and add
 * it to the body of the request
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default async function handleJobIDParameter(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  // Check if 'jobId' exists in the query parameters (GET), form-encoded body, or JSON body
  const lowerCaseQuery = keysToLowerCase(req.query);
  const lowerCaseBody = keysToLowerCase(req.body);
  let jobID = lowerCaseQuery.jobid || lowerCaseBody.jobid;

  // If 'jobId' exists, convert it to an array (if not already) and assign it to 'jobid' in the body
  if (jobID) {
    jobID = parseMultiValueParameter(jobID);
    req.body.jobid = jobID;
  }

  // Call next to pass control to the next middleware or route handler
  next();
}