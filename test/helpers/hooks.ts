import { before, after } from 'mocha';
import request from 'supertest';
import { auth } from './auth';

/**
 * Adds before / after hooks which call the given function with the given params, awaiting
 * its return value and placing it on `this[returnValueName]`
 *
 * @param {function} fn the (potentially async) function to hook
 * @param {string} returnValueName the name of the property on `this` where the return value
 *   should go
 * @param {...any} params the parameters to the function call
 * @returns {void}
 */
export function hookFunction(fn, returnValueName, ...params) {
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
 * @param {function|string} urlOrFn the URL to follow
 * @param {string} username optional username to provide for auth
 * @returns {void}
 */
export function hookUrl(urlOrFn, username = 'anonymous') {
  before(async function () {
    const url = typeof urlOrFn === 'string' ? urlOrFn : urlOrFn.call(this);
    this.urlRes = this.res;
    let req = request(this.frontend).get(url);
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
 * @param {string} username optional username to provide for auth
 * @returns {void}
 */
export function hookRedirect(username = undefined) {
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
 * @param {function} requestFn The request function to execute
 * @returns {void}
 */
export function hookRequest(requestFn, { username, ...options } = { username: undefined }) {
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
