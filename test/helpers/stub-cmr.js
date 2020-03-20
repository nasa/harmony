const { before, after } = require('mocha');
const sinon = require('sinon');
const cmr = require('../../app/util/cmr');

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
  before(function () {
    sinon.stub(cmr, functionName)
      .callsFake(() => response);
  });
  after(function () {
    if (cmr[functionName].restore) cmr[functionName].restore();
  });
}

exports.hookCmr = hookCmr;
