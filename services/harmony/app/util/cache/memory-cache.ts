import { LRUCache } from 'lru-cache';
import { Cache } from './cache';
import env from '../env';

// Simple implementation of a string cache backed by an in-memory
// least-recently-used (LRU) cache
export class MemoryCache extends Cache {
  data: LRUCache<string, string>;

  constructor(fetchMethod: (k: string) => Promise<string>) {
    super();
    const options = {
      maxSize: env.maxDataOperationCacheSize,
      sizeCalculation: (v: string): number => {
        return v.length;
      },
      fetchMethod,
    };
    this.data = new LRUCache(options);
  }

  async get(key: string): Promise<string> {
    return this.data.get(key);
  }

  async fetch(key: string): Promise<string> {
    return this.data.fetch(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}