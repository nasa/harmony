import { Request, Response, NextFunction, Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import logger from '../../../../app/util/log';
import DataOperation from '../../../../app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../../../app/util/crypto';
import { queryGranules } from '../query';

const encrypter = createEncrypter(process.env.SHARED_SECRET_KEY);
const decrypter = createDecrypter(process.env.SHARED_SECRET_KEY);

export interface QueryCmrRequest {
  outputDir?: string;
  harmonyInput?: object;
  scrollId?: string;
  maxCmrGranules?: number;
}

/**
 * Query the CMR as requested and create one or more STAC catalogs for the granule(s)
 *
 * @param workReq - The request to be made to the CMR
 * @returns a promise containing a tuple with thie total cmr hits, the combined totals of the
 * sizes of the granules in this result, and the combined sizes of all the granules included in 
 * the catalogs
 */
export async function doWork(workReq: QueryCmrRequest): Promise<[number, number, string]> {
  const startTime = new Date().getTime();
  const operation = new DataOperation(workReq.harmonyInput, encrypter, decrypter);
  const { outputDir, scrollId } = workReq;
  const appLogger = logger.child({ application: 'query-cmr' });
  const timingLogger = appLogger.child({ requestId: operation.requestId });
  timingLogger.info('timing.query-cmr.start');
  await fs.mkdir(outputDir, { recursive: true });
  const mkdirTime = new Date().getTime();
  timingLogger.info('timing.query-cmr.mkdir', { durationMs: mkdirTime - startTime });

  const [hits, totalGranulesSize, catalogs, newScrollId] = await queryGranules(operation, scrollId, workReq.maxCmrGranules);
  const granuleScrollingTime = new Date().getTime();
  timingLogger.info('timing.query-cmr.query-granules-scrolling', { durationMs: granuleScrollingTime - mkdirTime });

  const catalogFilenames = [];
  const promises = catalogs.map(async (catalog, i) => {
    const relativeFilename = `catalog${i}.json`;
    const filename = path.join(outputDir, relativeFilename);
    catalogFilenames.push(relativeFilename);
    await catalog.write(filename, true);
  });

  const catalogListFilename = path.join(outputDir, 'batch-catalogs.json');
  const catalogCountFilename = path.join(outputDir, 'batch-count.txt');

  await Promise.all(promises);
  const catalogWriteTime = new Date().getTime();
  timingLogger.info('timing.query-cmr.catalog-promises-write', { durationMs: catalogWriteTime - granuleScrollingTime });

  await fs.writeFile(catalogListFilename, JSON.stringify(catalogFilenames));
  await fs.writeFile(catalogCountFilename, catalogFilenames.length.toString());

  const catalogSummaryTime = new Date().getTime();
  timingLogger.info('timing.query-cmr.catalog-summary-write', { durationMs: catalogSummaryTime - catalogWriteTime });
  timingLogger.info('timing.query-cmr.end', { durationMs: catalogSummaryTime - startTime });

  return [hits, totalGranulesSize, newScrollId];
}

/**
 * Handler for work requests
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
async function doWorkHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const workReq: QueryCmrRequest = req.body;

    const [hits, totalGranulesSize, scrollId] = await doWork(workReq);

    res.status(200);
    res.send(JSON.stringify({ hits, totalGranulesSize, scrollID: scrollId }));

  } catch (e) {
    res.status(500);
    next(e);
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
