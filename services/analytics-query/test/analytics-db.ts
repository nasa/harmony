import { expect } from 'chai';
import { describe, it } from 'mocha';

import { fixtureDb, TEST_DB_OPTIONS } from './helpers/db';
import { AnalyticsDb } from '../app/query/analytics-db';
import { BusyError, NotReadyError } from '../app/util/errors';
import log from '../app/util/log';

/**
 * A promise and the function that resolves it
 */
function deferred(): { promise: Promise<void>, resolve: () => void } {
  let resolve: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('AnalyticsDb', () => {
  it('is not ready until it has been set up', async () => {
    const db = fixtureDb();
    expect(db.isReady).to.be.false;
    await db.init();
    expect(db.isReady).to.be.true;
    db.close();
  });

  it('runs at most maxConcurrent functions at once, queueing the rest', async () => {
    const db = fixtureDb({ maxConcurrent: 2, maxWaiting: 10 });
    let running = 0;
    let maxRunning = 0;
    const gate = deferred();
    const twoRunning = deferred();
    const calls = [1, 2, 3, 4, 5].map(() => db.withConnection(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      if (running === 2) twoRunning.resolve();
      await gate.promise;
      running -= 1;
    }));
    await twoRunning.promise;
    expect(running).to.equal(2);
    gate.resolve();
    await Promise.all(calls);
    expect(maxRunning).to.equal(2);
    db.close();
  });

  it('rejects callers as busy once maxWaiting are already waiting', async () => {
    const db = fixtureDb({ maxConcurrent: 1, maxWaiting: 1 });
    const gate = deferred();
    const first = db.withConnection(() => gate.promise);
    const second = db.withConnection(async () => {});
    await new Promise((r) => setTimeout(r, 100));
    await expect(db.withConnection(async () => {})).to.be.rejectedWith(BusyError);
    gate.resolve();
    await Promise.all([first, second]);
    db.close();
  });

  it('frees the slot when the function throws', async () => {
    const db = fixtureDb({ maxConcurrent: 1, maxWaiting: 0 });
    await expect(db.withConnection(async () => { throw new Error('boom'); })).to.be.rejectedWith('boom');
    await db.withConnection(async () => {}); // would be BusyError if the slot leaked
    db.close();
  });

  it('gives each caller its own connection, so interrupting one leaves the others running', async () => {
    const db = fixtureDb({ maxConcurrent: 2 });
    const long = db.withConnection(async (conn) => {
      setTimeout(() => conn.interrupt(), 200);
      return conn.run('SELECT count(*) FROM range(200000) a, range(200000) b WHERE (a.range * b.range) % 7 = 3');
    });
    const short = db.withConnection(async (conn) =>
      (await conn.runAndReadAll('SELECT 42 AS n')).getRowObjectsJson()[0].n);
    expect(await short).to.equal(42);
    await expect(long).to.be.rejectedWith(/Interrupted/);
    db.close();
  });

  it('recreates the instance once it is older than maxAgeMs, in the background, and says so', async () => {
    const db = fixtureDb({ maxAgeMs: 50 });
    const recreatedAgain = deferred();
    let recreated = 0;
    db.onRecreate = (): void => {
      recreated += 1;
      if (recreated === 2) recreatedAgain.resolve();
    };
    await db.init();
    expect(recreated).to.equal(1);
    await new Promise((r) => setTimeout(r, 100));
    // Runs on the old instance rather than waiting for the new one
    const n = await db.withConnection(async (conn) =>
      (await conn.runAndReadAll('SELECT count(*)::INTEGER AS n FROM jobs')).getRowObjectsJson()[0].n);
    expect(n).to.be.greaterThan(0);
    await recreatedAgain.promise;
    expect(recreated).to.equal(2);
    db.close();
  });

  it('keeps an old instance open for a query that got it just before it was replaced', async () => {
    const db = fixtureDb({ maxAgeMs: 50 });
    const replaced = deferred();
    let recreated = 0;
    db.onRecreate = (): void => {
      recreated += 1;
      if (recreated === 2) replaced.resolve();
    };
    await db.init();
    await new Promise((r) => setTimeout(r, 100));
    // Gets the expired instance (starting its replacement), and only uses it once it is replaced
    const n = await db.withConnection(async (conn) => {
      await replaced.promise;
      return (await conn.runAndReadAll('SELECT count(*)::INTEGER AS n FROM jobs')).getRowObjectsJson()[0].n;
    });
    expect(n).to.be.greaterThan(0);
    db.close();
  });

  it('fails as not ready once closed', async () => {
    const db = fixtureDb();
    await db.init();
    db.close();
    expect(db.isReady).to.be.false;
    await expect(db.init()).to.be.rejectedWith(/closed/);
    await expect(db.withConnection(async () => {})).to.be.rejectedWith(NotReadyError);
  });

  it('does not use an instance that was still being created when it was closed', async () => {
    const db = fixtureDb();
    const init = db.init();
    db.close();
    await expect(init).to.be.rejectedWith(/closed/);
    expect(db.isReady).to.be.false;
  });

  it('reports a catalog that cannot be attached as not ready', async () => {
    const db = new AnalyticsDb({ kind: 'fixture', path: '/nonexistent/fixture.duckdb' }, TEST_DB_OPTIONS, log);
    await expect(db.init()).to.be.rejected;
    expect(db.isReady).to.be.false;
    await expect(db.withConnection(async () => {})).to.be.rejectedWith(NotReadyError);
  });
});
