/* eslint-disable import/namespace */
import { before, after } from 'mocha';
import * as sinon from 'sinon';
import * as cmr from 'util/cmr';

/**
 * Replace a function in the `cmr` module with a given function. This is needed because
 * `replay` does not handle POSTs to the CMR correctly.
 *
 * @param {string} functionName The name of the function to be stubbed
 * @param {*} response The response the function should return
 * @returns {void}
 * @private
 */
function stubCmr(functionName, response) {
  sinon.stub(cmr, functionName)
    .callsFake(async () => {
      const resp = response;
      return resp;
    });
}

/**
 * Remove a stub from the `cmr` module
 *
 * @param {string} functionName The name of the function to reset
 * @returns {void}
 * @private
 */
function unStubCmr(functionName) {
  if (cmr[functionName].restore) cmr[functionName].restore();
}

/**
 * Adds before / after hooks in mocha to replace a function in the
 * `cmr` module with a function that generates the given response
 *
 * Example: (`cmrPostSearchBase` returns a 400 status with error message)
 * ```
* hookCmr('cmrPostSearchBase',
  { status: 400,
    data: { errors: ['Corrupt zip file'] }
  });
 * ```
 * @param {string} functionName The name of the function to stub
 * @param {object} response The desired response
 * @returns {void}
 */
function hookCmr(functionName, response) {
  before(async function () {
    stubCmr(functionName, response);
  });
  after(async function () {
    unStubCmr(functionName);
  });
}

module.exports = {
  hookCmr,
};
