import { NextFunction, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';

/**
 * Middleware to add UMM-Vis to the DataOperation for any requested variables (or collections
 * if no of `all` variables are requested). At the point where this middleware is invoked,
 * the collections should have already been attached to the request with the UMM-Vis information
 * attached (see `cmrCollectionReader`). This middleware just applies the UMM-Vis information
 * to the appropriate sources.
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export function setUmmVis(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  const { operation } = req;
  if (!operation?.sources) {
    return next();
  }

  for (const source of operation.sources) {
    const collectionId = source.collection;
    const collection = req.context.collections.find(coll => coll.id === collectionId);
    // source.visualizations = collection.visualizations?.map(vis => vis.umm);
    source.visualizations = collection.visualizations?.map((vis) => {
      return vis.umm;
    });
  }

  return next();
}