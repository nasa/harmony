const { before, after } = require('mocha');
const sinon = require('sinon');
const cmr = require('../../app/util/cmr');

/**
 * Adds before / after hooks in mocha to replace a function in the the
 * `cmr` module with a function that generates a response with the given
 * status and message
 * @param {string} functionName
 * @param {object} response
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
