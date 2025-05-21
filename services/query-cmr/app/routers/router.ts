import { Request, Response, NextFunction, Router } from 'express';
import logger from '../../../harmony/app/util/log';
import { resolve } from '../../../harmony/app/util/url';
import DataOperation from '../../../harmony/app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../../harmony/app/util/crypto';
import { QueryCmrResponse, validateGranules, queryGranules } from '../query';
import { objectStoreForProtocol } from '../../../harmony/app/util/object-store';
import { ServerError } from '../../../harmony/app/util/errors';
import { Logger } from 'winston';

const encrypter = createEncrypter(process.env.SHARED_SECRET_KEY);
const decrypter = createDecrypter(process.env.SHARED_SECRET_KEY);

export interface QueryCmrRequest {
  outputDir?: string;
  harmonyInput?: object;
  scrollId?: string;
  maxCmrGranules?: number;
  workItemId: number;
}

/**
 * Query the CMR as requested and create one or more STAC catalogs for the granule(s)
 *
 * @param workReq - The request to be made to the CMR
 * @param workLogger - The logger to use for logging messages
 * @returns a promise containing a tuple with the total cmr hits, the combined totals of the
 * sizes of the granules in this result, and the combined sizes of all the granules included in
 * the catalogs
 */
export async function doWork(workReq: QueryCmrRequest, workLogger: Logger = logger): Promise<QueryCmrResponse> {
  const startTime = new Date().getTime();
  const operation = new DataOperation(workReq.harmonyInput, encrypter, decrypter);
  const { outputDir, maxCmrGranules, scrollId } = workReq;

  // perform granule validation if there is granValidation in operation.extraArgs
  if (operation.extraArgs?.granValidation) {
    const validateResult = await validateGranules(operation, scrollId, maxCmrGranules, workLogger);
    return validateResult;
  }

  const appLogger = workLogger.child({ application: 'query-cmr' });
  const timingLogger = appLogger.child({ requestId: operation.requestId });
  timingLogger.info('timing.query-cmr.start');
  const queryCmrStartTime = new Date().getTime();
  const [totalItemsSize, outputItemSizes, catalogs, newScrollId, hits] = await queryGranules(operation, scrollId, maxCmrGranules, workLogger);
  const granuleSearchTime = new Date().getTime();
  timingLogger.info('timing.query-cmr.query-granules-search', { durationMs: granuleSearchTime - queryCmrStartTime });

  const catalogFilenames = [];
  const promises = catalogs.map(async (catalog, i) => {
    const relativeFilename = `catalog${i}.json`;
    const catalogUrl = resolve(outputDir, relativeFilename);
    catalogFilenames.push(relativeFilename);
    await catalog.write(catalogUrl, true);
  });

  const catalogListUrl = resolve(outputDir, 'batch-catalogs.json');
  const catalogCountUrl = resolve(outputDir, 'batch-count.txt');

  await Promise.all(promises);
  const catalogWriteTime = new Date().getTime();
  timingLogger.info('timing.query-cmr.catalog-promises-write', { durationMs: catalogWriteTime - granuleSearchTime });

  const s3 = objectStoreForProtocol('s3');
  await s3.upload(JSON.stringify(catalogFilenames), catalogListUrl, null, 'application/json');
  await s3.upload(catalogFilenames.length.toString(), catalogCountUrl, null, 'text/plain');

  const catalogSummaryTime = new Date().getTime();
  timingLogger.info('timing.query-cmr.catalog-summary-write', { durationMs: catalogSummaryTime - catalogWriteTime });
  timingLogger.info('timing.query-cmr.end', { durationMs: catalogSummaryTime - startTime });

  return { hits, totalItemsSize, outputItemSizes, scrollID: newScrollId };
}

/**
 * Handler for work requests
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
async function doWorkHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  let workLogger;
  try {
    const workReq: QueryCmrRequest = req.body;
    workLogger = logger.child({ workItemId: workReq.workItemId });
    const response = await doWork(workReq, workLogger);
    res.status(200);
    res.send(JSON.stringify(response));
  } catch (e) {
    if (workLogger) {
      workLogger.error(e);
    } else {
      logger.error(e);
    }
    next(new ServerError('An unexpected error was encountered while querying for granules.'));
  }
}

/**
 *
 * @returns Router configured with service routes.
 */
export default function router(): Router {
  const result = Router();

  result.get('/liveness', async (req, res, _next: NextFunction): Promise<void> => {
    res.send('OK');
  });

  result.get('/readiness', async (req, res, _next: NextFunction): Promise<void> => {
    res.send('OK');
  });

  result.post('/work', doWorkHandler);

  return result;
}
