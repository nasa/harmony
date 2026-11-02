import * as fs from 'fs';
import * as path from 'path';

import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers';

import { ResolvedScenario } from './scenario';

//
// Everything in this file has to happen before the first Harmony module is required: Harmony's
// env modules snapshot process.env when they load, and the database connection is created from
// db/knexfile.js the first time app/util/db is imported. So the CLI calls these functions first
// and only then requires the simulation itself.
//

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Virtual time starts at a fixed instant so that runs are reproducible
export const SIM_EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');

/**
 * Sets the environment Harmony's modules will read when they load. Mirrors the settings used by
 * Harmony's own tests (services/harmony/test/helpers/env.ts), plus any scenario overrides.
 *
 * @param scenario - the scenario being run
 */
export function configureEnvironment(scenario: ResolvedScenario): void {
  Object.assign(process.env, {
    // NODE_ENV=test also stops Harmony from reading the developer's .env file
    NODE_ENV: 'test',
    DATABASE_TYPE: 'sqlite',
    COOKIE_SECRET: 'foo',
    OAUTH_CLIENT_ID: 'foo',
    OAUTH_UID: 'foo',
    OAUTH_PASSWORD: 'foo',
    SHARED_SECRET_KEY: '_THIS_IS_MY_32_CHARS_SECRET_KEY_',
  }, scenario.env);
}

/**
 * Loads a sqlite3 driver built for this platform. Harmony's own is preferred; the simulator's
 * copy is the fallback for when Harmony's node_modules was installed on a different platform,
 * e.g. a dev container sharing node_modules with a macOS host.
 *
 * @param harmonyDir - the services/harmony directory
 * @returns the sqlite3 module
 * @throws Error - if neither driver can be loaded
 */
function loadSqliteDriver(harmonyDir: string): unknown {
  const errors: string[] = [];
  for (const [where, paths] of [['services/harmony', [harmonyDir]], ['tools/fair-queueing-sim', [__dirname]]]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(require.resolve('sqlite3', { paths: paths as string[] }));
    } catch (e) {
      errors.push(`  ${where}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error('Could not load a sqlite3 driver built for this platform:\n' + errors.join('\n') +
    '\nRun `npm rebuild sqlite3` in tools/fair-queueing-sim (or services/harmony) to build one.');
}

/**
 * Points Harmony's sqlite connection at a fresh database file for this run and tunes it for
 * speed. The simulator is the only process using the file, so durability doesn't matter.
 *
 * @param runDir - the output directory for the run
 * @returns the path of the database file
 */
export function configureDatabaseFile(runDir: string): string {
  const filename = path.join(runDir, 'sim.sqlite3');
  for (const f of [filename, `${filename}-journal`]) {
    fs.rmSync(f, { force: true });
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const knexfile = require(path.join(REPO_ROOT, 'db', 'knexfile.js'));
  const harmonyDir = path.join(REPO_ROOT, 'services', 'harmony');
  // knex draws on Math.random for an ID for every query it compiles. Harmony's only other use of
  // Math.random on the scheduling path is the job shuffle, so give knex counters instead: the
  // shuffle then sees the same random stream regardless of how many queries a policy (or a
  // version of Harmony) happens to run. This has to happen before knex's query compiler loads,
  // since it keeps its own reference to the function.
  // eslint-disable-next-line n/no-extraneous-require
  const knexIds = require(require.resolve('knex/lib/util/nanoid', { paths: [harmonyDir] }));
  let nextQueryId = 0;
  knexIds.nanoid = (): string => `q${(nextQueryId++).toString(36)}`;
  knexIds.nanonum = (): string => String(nextQueryId++);
  // the dialect has to come from the same knex instance Harmony uses
  // eslint-disable-next-line n/no-extraneous-require
  const SqliteClient = require(require.resolve('knex/lib/dialects/sqlite3', { paths: [harmonyDir] }));
  /* eslint-enable @typescript-eslint/no-require-imports */
  const sqlite3 = loadSqliteDriver(harmonyDir);
  // Harmony only ever checks whether the client is 'pg', so a client class is fine here
  knexfile.client = class extends SqliteClient {
    _driver(): unknown {
      return sqlite3;
    }
  };
  knexfile.connection.filename = filename;
  knexfile.pool = {
    afterCreate: (conn, done): void => {
      conn.exec('PRAGMA synchronous = OFF; PRAGMA journal_mode = MEMORY;', done);
    },
  };
  // knex warns on every `forUpdate` against sqlite, which the update path uses constantly
  knexfile.log = {
    warn: (): void => {},
    deprecate: (): void => {},
    debug: (): void => {},
    error: (message: unknown): void => console.error(message),
  };
  return filename;
}

/**
 * Replaces Date (and performance.now, which lru-cache uses for TTLs) with a virtual clock that
 * only moves when the simulation advances it. Timers are left alone: the simulation never waits
 * on real timers, and the database driver relies on them.
 *
 * @returns the installed clock
 */
export function installVirtualClock(): InstalledClock {
  const clock = FakeTimers.withGlobal(globalThis).install({ now: SIM_EPOCH_MS, toFake: ['Date'] });
  performance.now = (): number => clock.now - SIM_EPOCH_MS;
  return clock;
}
