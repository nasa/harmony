import { NextFunction, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';
import { getVisualizationsForCollection } from '../util/cmr';

/**
 * Middleware to add UMM-Vis to the DataOperation for the requested collections
 * if none or `all` variables are requested.
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export async function setUmmVisForCollections(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): Promise<void> {
  const { operation } = req;
  if (!operation?.sources) {
    return next();
  }

  const promises = [];

  const { requestedVariables } = req.context;

  if (requestedVariables?.length === 0 || requestedVariables?.includes('all')) {
    // add in any umm-vis for the collections
    for (const source of operation.sources) {
      const collectionId = source.collection;
      const collection = req.context.collections.find(coll => coll.id === collectionId);
      promises.push(getVisualizationsForCollection(req.context, collection, req.accessToken));
    }
    const visualizations = await Promise.all(promises);

    let index = 0;
    for (const source of operation.sources) {
      source.visualizations = visualizations[index].map(vis => vis.umm);
      index += 1;
    }
  }

  // variable visualizations are handled in `validateAndSetVariables`

  return next();
}