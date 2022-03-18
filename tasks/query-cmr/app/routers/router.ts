import { Request, Response, NextFunction, Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import logger from '../../../../app/util/log';
import DataOperation from '../../../../app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../../../app/util/crypto';
import { queryGranules, queryGranulesScrolling } from '../query';

const encrypter = createEncrypter(process.env.SHARED_SECRET_KEY);
const decrypter = createDecrypter(process.env.SHARED_SECRET_KEY);

export interface QueryCmrRequest {
  outputDir?: string;
  harmonyInput?: object;
  query?: (string | number)[];
  pageSize?: number;
  maxPages?: number;
  batchSize?: number;
  scrollId?: string;
}

/**
 * Handler for work requests
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param _next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
async function doWork(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const startTime = new Date().getTime();
  const appLogger = logger.child({ application: 'query-cmr' });
  const workReq: QueryCmrRequest = req.body;
  const operation = new DataOperation(workReq.harmonyInput, encrypter, decrypter);
  const timingLogger = appLogger.child({ requestId: operation.requestId });
  timingLogger.info('timing.query-cmr.start');
  await fs.mkdir(workReq.outputDir, { recursive: true });

  const catalogs = workReq.scrollId
    ? await queryGranulesScrolling(operation, workReq.scrollId)
    : await queryGranules(
      operation,
      workReq.query as string[],
      workReq.pageSize,
      workReq.maxPages,
      workReq.batchSize,
    );

  const catalogFilenames = [];
  const promises = catalogs.map(async (catalog, i) => {
    const relativeFilename = `catalog${i}.json`;
    const filename = path.join(workReq.outputDir, relativeFilename);
    catalogFilenames.push(relativeFilename);
    await catalog.write(filename, true);
  });

  const catalogListFilename = path.join(workReq.outputDir, 'batch-catalogs.json');
  const catalogCountFilename = path.join(workReq.outputDir, 'batch-count.txt');

  await Promise.all(promises);

  await fs.writeFile(catalogListFilename, JSON.stringify(catalogFilenames));
  await fs.writeFile(catalogCountFilename, catalogFilenames.length.toString());

  res.status(200);
  res.send('OK');

  const durationMs = new Date().getTime() - startTime;
  timingLogger.info('timing.query-cmr.end', { durationMs });
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

  result.post('/work', doWork);

  return result;
}
