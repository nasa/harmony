import { NextFunction } from 'express';
import { getUmmCollectionsByIds } from '../util/cmr';
import HarmonyRequest from '../models/harmony-request';

/**
 * Express.js middleware that reads the UMM JSON format of the collections and load them into operation
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
async function cmrUmmCollectionReader(req: HarmonyRequest, res, next: NextFunction): Promise<void> {
  try {
    const hasUmmConditional = req.context.serviceConfig?.steps?.filter((s) => s.conditional?.umm_c);
    if (hasUmmConditional && hasUmmConditional.length > 0) {
      req.operation.ummcollections = await getUmmCollectionsByIds(req.collectionIds, req.accessToken);
    }
    next();
  } catch (error) {
    req.collectionIds = [];
    req.collections = [];
    next(error);
  }
}

export = cmrUmmCollectionReader;
