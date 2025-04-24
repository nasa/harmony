import { LRUCache } from 'lru-cache';
import { Cache } from './cache';
import env from '../env';

// Simple implementation of a string cache backed by an in-memory
// least-recently-used (LRU) cache

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchMethod = (key: string, context?: any) => Promise<string>;

interface MemoryCacheOptions {
  ttl?: number; // Optional TTL in milliseconds
  maxSize?: number; // Optional max size override
}

export class MemoryCache extends Cache {
  private data: LRUCache<string, string>;

  private fetchMethod: FetchMethod;

  private pending: Map<string, Promise<string>> = new Map();

  constructor(fetchMethod: FetchMethod, options?: MemoryCacheOptions) {
    super();
    this.fetchMethod = fetchMethod;

    this.data = new LRUCache<string, string>({
      maxSize: options?.maxSize ?? env.maxDataOperationCacheSize,
      ttl: options?.ttl, // No expiration if undefined
      sizeCalculation: (value: string): number => value.length,
    });
  }

  async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fetch(key: string, context?: any): Promise<string> {
    const cached = this.data.get(key);
    if (cached !== undefined) return cached;

    if (this.pending.has(key)) {
      return this.pending.get(key)!;
    }

    const promise = this.fetchMethod(key, context)
      .then((value) => {
        this.data.set(key, value);
        this.pending.delete(key);
        return value;
      })
      .catch((err) => {
        this.pending.delete(key);
        throw err;
      });

    this.pending.set(key, promise);
    return promise;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}
