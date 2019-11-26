const { before, after } = require('mocha');

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

module.exports = {
  hookFunction,
};
