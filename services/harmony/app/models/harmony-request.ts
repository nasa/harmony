import { Response, NextFunction, Request } from 'express';
import { CmrCollection } from '../util/cmr';
import DataOperation from './data-operation';
import { asyncLocalStorage } from '../util/async-store';

/**
 * Contains additional information about a request
 */
export default interface HarmonyRequest extends Request {
  collections: CmrCollection[];
  collectionIds: string[];
  operation: DataOperation;
  user: string;
  accessToken: string;
  authorized: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  files?: any;
}

/**
 * Middleware to add request context information to the data operation.
 *
 * @param req - The client request, containing an operation
 * @param _res - The server response (not used)
 * @param next - The next function in the middleware chain
 *
 */
export function addRequestContextToOperation(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  const context = asyncLocalStorage.getStore();
  const { operation } = req;

  if (!operation) return next();

  operation.requestId = context.id;
  if (context.messages.length > 0) {
    operation.message = context.messages.join(' ');
  }
  operation.requestStartTime = context.startTime;
  return next();
}
