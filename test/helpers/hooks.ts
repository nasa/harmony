import { before, after } from 'mocha';
import request from 'supertest';
import { auth } from './auth';

/**
 * Adds before / after hooks which call the given function with the given params, awaiting
 * its return value and placing it on `this[returnValueName]`
 *
 * @param fn - the (potentially async) function to hook
 * @param returnValueName - the name of the property on `this` where the return value
 *   should go
 * @param params - the parameters to the function call
 */
export function hookFunction<T>(fn: Function, returnValueName: string, ...params: T[]): void {
  before(async function () {
    this[returnValueName] = await fn.bind(this)(...params);
  });
  after(function () {
    delete this[returnValueName];
  });
}

/**
 * Adds before / after hooks to follow a given URL
 *
 * @param urlOrFn - the URL to follow
 * @param username - optional username to provide for auth
 * @param query - Mapping of query param names to values
 */
export function hookUrl(urlOrFn: Function | string, username = 'anonymous', query: object = {}): void {
  before(async function () {
    const url = typeof urlOrFn === 'string' ? urlOrFn : urlOrFn.call(this);
    this.urlRes = this.res;
    let req = request(this.frontend).get(url).query(query);
    if (username) req = req.use(auth({ username }));
    this.res = await req;
  });

  after(function () {
    this.res = this.urlRes;
    delete this.urlRes;
  });
}

/**
 * Adds before / after hooks to follow an HTTP redirect contained in this.res, setting this.res
 * to the response from following the redirect and this.redirectRes to the original response.
 *
 * @param username - optional username to provide for auth
 */
export function hookRedirect(username: string = undefined): void {
  hookUrl(function () {
    const { location } = this.res.headers;
    if (!location) throw new TypeError('Attempted to hook an HTTP redirect with no Location header');
    return location;
  }, username);
}

/**
 * Adds before / after hooks to execute an HTTP request against a harmony endpoint and setting
 * the result to this.res
 *
 * @param requestFn - The request function to execute
 */
export function hookRequest(
  requestFn: Function, { username, ...options } = { username: undefined },
): void {
  before(async function () {
    let req = requestFn(this.frontend, options);
    if (username) {
      req = req.use(auth({ username }));
    }
    this.res = await req;
  });
  after(function () {
    delete this.res;
  });
}

/**
 * Adds before / after hooks to execute an HTTP request against a harmony backend endpoint
 * and setting the result to this.res
 *
 * @param requestFn - The request function to execute
 */
export function hookBackendRequest(
  requestFn: Function, options = { },
): void {
  before(async function () {
    this.res = await requestFn(this.backend, options);
  });
  after(function () {
    delete this.res;
  });
}
