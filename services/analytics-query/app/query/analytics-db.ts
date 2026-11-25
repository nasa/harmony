import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { Logger } from 'winston';

import { CatalogSource, createLockedInstance, InstanceLimits, openConnection } from './catalog';
import { BusyError, NotReadyError } from '../util/errors';

// How long to keep using an expired instance after failing to replace it before trying again, so
// a catalog that is down isn't retried on every request
const REFRESH_RETRY_MS = 60_000;

export interface AnalyticsDbOptions extends InstanceLimits {
  // How many connections may be in use at once, and how many callers may wait for one
  maxConcurrent: number;
  maxWaiting: number;
  // Recreate the instance once it is this old (0 = never), e.g. to pick up refreshed credentials
  maxAgeMs: number;
}

/**
 * An instance and the number of connections currently using it, so a replaced instance is only
 * closed once its last query finishes
 */
interface TrackedInstance {
  instance: DuckDBInstance;
  createdAtMs: number;
  inUse: number;
  retired: boolean;
}

/**
 * Owns the locked-down DuckDB instance the analytics queries run against, hands out a connection
 * per query (so a query that runs too long can be interrupted without affecting the others), and
 * limits how many queries run at once.
 */
export class AnalyticsDb {
  private current: TrackedInstance | null = null;

  private creating: Promise<TrackedInstance> | null = null;

  // When a failed replacement of an expired instance may next be tried
  private retryRefreshAtMs = 0;

  // Once closed, it stays closed: init and withConnection fail, and an instance still being created
  // is closed rather than used
  private closed = false;

  private active = 0;

  private waiters: (() => void)[] = [];

  // Called whenever a new instance replaces the old one, e.g. to clear a schema cache
  onRecreate: () => void = () => {};

  constructor(private source: CatalogSource, private options: AnalyticsDbOptions, private logger: Logger) {}

  /**
   * Whether the instance has been set up
   */
  get isReady(): boolean {
    return this.current !== null;
  }

  /**
   * Set up the instance
   *
   * @throws error if the catalog can't be attached, or the instance has been closed
   */
  async init(): Promise<void> {
    this.unreserve(await this.reserve());
  }

  /**
   * Get the current instance, counted as in use, creating it if there is none yet. One that is too
   * old is still returned while its replacement is created in the background, so queries don't
   * wait for it. It is counted before this returns, since a replacement finishing while the caller
   * waits to resume would otherwise close it. Release it with unreserve.
   *
   * @throws error if there is no instance and one can't be created, or it has been closed
   */
  private async reserve(): Promise<TrackedInstance> {
    if (this.closed) {
      throw new Error('The analytics DuckDB instance has been closed');
    }
    if (!this.current) {
      // Nothing to use until the first instance exists, so wait for it. Replacing it needs another
      // to be created, which can't have happened by the time this resumes - but close() can have.
      const tracked = await this.create();
      if (tracked.retired) {
        throw new Error('The analytics DuckDB instance has been closed');
      }
      tracked.inUse += 1;
      return tracked;
    }
    const { maxAgeMs } = this.options;
    const expired = maxAgeMs > 0 && Date.now() - this.current.createdAtMs > maxAgeMs;
    if (expired && !this.creating && Date.now() >= this.retryRefreshAtMs) {
      this.create().catch((e) => {
        if (this.closed) return;
        // Keep using the old instance rather than failing queries, and try again in a while
        this.retryRefreshAtMs = Date.now() + REFRESH_RETRY_MS;
        this.logger.error('Failed to recreate the analytics DuckDB instance, still using the old one');
        this.logger.error(e);
      });
    }
    this.current.inUse += 1;
    return this.current;
  }

  /**
   * Release an instance from reserve, closing it if it has been replaced and nothing else uses it
   */
  private unreserve(tracked: TrackedInstance): void {
    tracked.inUse -= 1;
    if (tracked.retired && tracked.inUse === 0) {
      tracked.instance.closeSync();
    }
  }

  /**
   * Create an instance and make it the current one, retiring the one it replaces. Only one is
   * created at a time; callers while it is being created get the same promise.
   */
  private create(): Promise<TrackedInstance> {
    this.creating ??= (async (): Promise<TrackedInstance> => {
      try {
        const startMs = Date.now();
        const instance = await createLockedInstance(this.source, this.options);
        if (this.closed) {
          instance.closeSync();
          throw new Error('The analytics DuckDB instance has been closed');
        }
        const tracked = { instance, createdAtMs: Date.now(), inUse: 0, retired: false };
        if (this.current) {
          this.retire(this.current);
        }
        this.current = tracked;
        this.logger.info(`Created analytics DuckDB instance for ${this.source.kind} catalog`, {
          durationMs: Date.now() - startMs,
        });
        this.onRecreate();
        return tracked;
      } finally {
        this.creating = null;
      }
    })();
    return this.creating;
  }

  /**
   * Mark an instance as replaced, closing it once nothing is using it
   */
  private retire(tracked: TrackedInstance): void {
    tracked.retired = true;
    if (tracked.inUse === 0) {
      tracked.instance.closeSync();
    }
  }

  /**
   * Wait for a free slot
   *
   * @throws BusyError if too many callers are already waiting
   */
  private async acquire(): Promise<void> {
    if (this.active < this.options.maxConcurrent) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= this.options.maxWaiting) {
      throw new BusyError();
    }
    // release() hands its slot straight to the next waiter, so `active` is unchanged
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }

  /**
   * Run a function with a connection of its own, once a slot is free. The connection is closed
   * afterwards.
   *
   * @param fn - the function
   * @returns what the function returns
   * @throws BusyError if too many queries are running or waiting
   * @throws NotReadyError if the instance can't be set up
   */
  async withConnection<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      let tracked: TrackedInstance;
      try {
        tracked = await this.reserve();
      } catch (e) {
        this.logger.error(e);
        throw new NotReadyError();
      }
      let conn: DuckDBConnection | null = null;
      try {
        conn = await openConnection(tracked.instance);
        return await fn(conn);
      } finally {
        conn?.closeSync();
        this.unreserve(tracked);
      }
    } finally {
      this.release();
    }
  }

  /**
   * Close the instance, for good: queries still running finish first, and later calls fail as not
   * ready
   */
  close(): void {
    this.closed = true;
    if (this.current) {
      this.retire(this.current);
      this.current = null;
    }
  }
}
