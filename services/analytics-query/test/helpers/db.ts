import { after, before } from 'mocha';

import { FIXTURE_PATH } from './fixture';
import { AnalyticsDb, AnalyticsDbOptions } from '../../app/query/analytics-db';
import { loadSchema, tableNames } from '../../app/query/schema';
import log from '../../app/util/log';

export const TEST_DB_OPTIONS: AnalyticsDbOptions = {
  memoryLimit: '512MB', threads: 2, maxConcurrent: 4, maxWaiting: 16, maxAgeMs: 0,
};

/**
 * Create an instance manager over the fixture
 */
export function fixtureDb(options: Partial<AnalyticsDbOptions> = {}): AnalyticsDb {
  return new AnalyticsDb({ kind: 'fixture', path: FIXTURE_PATH }, { ...TEST_DB_OPTIONS, ...options }, log);
}

/**
 * Give the suite an instance manager over the fixture, set up before its tests and closed after
 *
 * @returns accessors for the instance manager and the queryable table names, valid inside tests
 */
export function hookFixtureDb(): { db: () => AnalyticsDb, tables: () => Set<string> } {
  let db: AnalyticsDb;
  let tables: Set<string>;
  before(async () => {
    db = fixtureDb();
    await db.init();
    tables = tableNames(await db.withConnection(loadSchema));
  });
  after(() => db.close());
  return { db: () => db, tables: () => tables };
}
