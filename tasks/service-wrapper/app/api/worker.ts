import { NextFunction, Request, Response } from 'express';
import sem from '../util/semaphore';
import { runServiceForRequest } from '../service/service-runner';

/**
 * Run the service when another instance is not already running
 * @param req - An express request
 * @param res  - An express response
 * @param next - The next handler to call in the express route chain
 */
export default async function doWork(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  sem.take(async () => {
    runServiceForRequest(req.body, res);
  });
}
