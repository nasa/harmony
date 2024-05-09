// Abstract base class for a simple cache that handles `string` keys/values
export abstract class Cache {
  /**
   * get a value from the - returning `undefined` if the key is not in the cache
   * @param key - the key string to use to get the value
   * @returns A `Promise` containing a `string` or `undefined` if the key can not be found
   */
  abstract get(key: string): Promise<string>;
  /**
   * get a value from the cache. if the key is not in the cache, fetch the value from somewhere else
   * and insert it into the cache before returning it
   * @param key - the key string to use to get the value
   * @returns A `Promise` containing a `string` or `undefined` if the key can not be found
   */
  abstract fetch(key: string): Promise<string>;
  /**
   * set a value in the cache
   * @param key - the key string to use to store the value
   * @param value - the value string to store
   */
  abstract set(key: string, value: string): Promise<void>;
}