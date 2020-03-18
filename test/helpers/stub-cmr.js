const { before, after } = require('mocha');
const sinon = require('sinon');
const cmr = require('../../app/util/cmr');

/**
 * Adds before / after hooks in mocha to replace a function in the the
 * `cmr` module with a function that generates a response with the given
 * status and message
 * @param {string} functionName
 * @param {number} status
 * @param {string} message
 * @returns {void}
 */
function hookCmr(functionName, status, message) {
  before(function () {
    sinon.stub(cmr, functionName)
      .callsFake(() => {
        const resp = {
          status,
          body: {
            code: 'harmony.CmrError',
            description: message,
          },
        };
        return resp;
      });
  });
  after(function () {
    if (cmr[functionName].restore) cmr[functionName].restore();
  });
}

exports.hookCmr = hookCmr;
