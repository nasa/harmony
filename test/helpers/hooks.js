const { before, after } = require('mocha');
const request = require('supertest');
const { auth } = require('./auth');

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
function hookFunction(fn, returnValueName, ...params) {
  before(async function () {
    this[returnValueName] = await fn.bind(this)(...params);
  });
  after(function () {
    delete this[returnValueName];
  });
}

/**
 * Adds before / after hooks to follow an HTTP redirect contained in this.res, setting this.res
 * to the response from following the redirect and this.redirectRes to the original response.
 *
 * @param {string} username optional username to provide for auth
 * @returns {void}
 */
function hookRedirect(username = undefined) {
  before(async function () {
    const { location } = this.res.headers;
    if (!location) throw new TypeError('Attempted to hook an HTTP redirect with no Location header');
    this.redirectRes = this.res;
    let req = request(this.frontend).get(location);
    if (username) req = req.use(auth({ username }));
    this.res = await req;
  });

  after(function () {
    this.res = this.redirectRes;
    delete this.redirectRes;
  });
}

module.exports = {
  hookFunction,
  hookRedirect,
};
