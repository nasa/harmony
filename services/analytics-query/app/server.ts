import express from 'express';

import { AnalyticsDb } from './query/analytics-db';
import { CatalogSource } from './query/catalog';
import { SchemaCache } from './query/schema';
import router from './routers/router';
import env from './util/env';
import log from './util/log';

// How long to wait before trying again when the catalog can't be attached at startup
const INIT_RETRY_MS = 30_000;

/**
 * Get where the analytics tables come from, from the environment
 */
export function catalogSource(): CatalogSource {
  if (env.analyticsQueryFixturePath) {
    return { kind: 'fixture', path: env.analyticsQueryFixturePath };
  }
  if (env.useLocalstack) {
    return {
      kind: 'ministack',
      // ministack's Iceberg REST endpoint serves its one table bucket at any ARN
      bucketArn: env.s3TableBucketArn || `arn:aws:s3tables:${env.awsDefaultRegion}:000000000000:bucket/harmony-analytics`,
      region: env.awsDefaultRegion,
      localstackHost: env.localstackHost,
    };
  }
  return { kind: 'aws', bucketArn: env.s3TableBucketArn, region: env.awsDefaultRegion };
}

/**
 * Create the DuckDB instance manager from the environment
 */
export function createDb(source: CatalogSource = catalogSource()): AnalyticsDb {
  return new AnalyticsDb(source, {
    memoryLimit: env.analyticsQueryMemoryLimit,
    threads: env.analyticsQueryThreads,
    maxConcurrent: env.analyticsQueryMaxConcurrent,
    maxWaiting: env.analyticsQueryMaxWaiting,
    maxAgeMs: env.analyticsQueryInstanceMaxAgeMinutes * 60_000,
  }, log);
}

/**
 * Create the express app
 *
 * @param db - the instance manager queries run against
 * @returns the app
 */
export function createApp(db: AnalyticsDb): express.Express {
  const schemaCache = new SchemaCache(env.analyticsSchemaCacheSeconds);
  db.onRecreate = (): void => schemaCache.clear();
  const app = express();
  app.use('/', router({
    db,
    schemaCache,
    limits: { maxRows: env.analyticsQueryMaxRows, timeoutMs: env.analyticsQueryTimeoutMs },
    sharedSecret: env.analyticsQuerySharedSecret,
    logger: log,
  }));
  return app;
}

/**
 * Set up the instance, retrying until it succeeds (e.g. while ministack is still starting)
 */
async function initWithRetry(db: AnalyticsDb): Promise<void> {
  try {
    await db.init();
  } catch (e) {
    log.error(`Could not attach the analytics catalog, retrying in ${INIT_RETRY_MS / 1000}s`);
    log.error(e);
    setTimeout(() => void initWithRetry(db), INIT_RETRY_MS);
  }
}

/**
 * Start the application
 */
export default async function start(): Promise<void> {
  const db = createDb();
  const app = createApp(db);
  app.listen(env.port, '0.0.0.0', () => {
    log.info(`Application listening on port ${env.port}`);
  });
  await initWithRetry(db);
}

if (require.main === module) {
  void start();
}
