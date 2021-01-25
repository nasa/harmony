import { NextFunction, Request } from 'express';
import { ServerResponse } from 'http';
import { CmrCollection } from '../util/cmr';
import RequestContext from './request-context';
import DataOperation from './data-operation';

/**
 * Contains additional information about a request
 */
export default interface HarmonyRequest extends Request {
  context: RequestContext;
  collections: CmrCollection[];
  collectionIds: string[];
  operation: DataOperation;
  user: string;
  accessToken: string;
  authorized: boolean;
}

/**
 * Middleware to add request context information to the data operation.
 *
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 *
 */
export function addRequestContextToOperation(
  req: HarmonyRequest, res: ServerResponse, next: NextFunction,
): void {
  const { operation, context } = req;

  if (!operation) return next();

  operation.requestId = context.id;
  if (req.context.messages.length > 0) {
    operation.message = req.context.messages.join(' ');
  }
  return next();
}
