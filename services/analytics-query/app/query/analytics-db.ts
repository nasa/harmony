import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { Logger } from 'winston';

import { CatalogSource, createLockedInstance, InstanceLimits, openConnection } from './catalog';
import { BusyError, NotReadyError } from '../util/errors';

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
   * @throws error if the catalog can't be attached
   */
  async init(): Promise<void> {
    await this.instance();
  }

  /**
   * Get the current instance, creating it (or replacing it, if it is too old) if needed
   */
  private async instance(): Promise<TrackedInstance> {
    const { maxAgeMs } = this.options;
    const expired = this.current && maxAgeMs > 0 && Date.now() - this.current.createdAtMs > maxAgeMs;
    if (this.current && !expired) {
      return this.current;
    }
    // Only one caller creates the instance; the rest wait for it
    this.creating ??= (async (): Promise<TrackedInstance> => {
      try {
        const startMs = Date.now();
        const instance = await createLockedInstance(this.source, this.options);
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
    try {
      return await this.creating;
    } catch (e) {
      if (this.current) {
        // Keep using the old instance rather than failing queries, and try again next time
        this.logger.error('Failed to recreate the analytics DuckDB instance, still using the old one');
        this.logger.error(e);
        return this.current;
      }
      throw e;
    }
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
        tracked = await this.instance();
      } catch (e) {
        this.logger.error(e);
        throw new NotReadyError();
      }
      tracked.inUse += 1;
      let conn: DuckDBConnection | null = null;
      try {
        conn = await openConnection(tracked.instance);
        return await fn(conn);
      } finally {
        conn?.closeSync();
        tracked.inUse -= 1;
        if (tracked.retired && tracked.inUse === 0) {
          tracked.instance.closeSync();
        }
      }
    } finally {
      this.release();
    }
  }

  /**
   * Close the instance
   */
  close(): void {
    if (this.current) {
      this.retire(this.current);
      this.current = null;
    }
  }
}
