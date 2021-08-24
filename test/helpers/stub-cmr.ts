import { before, after } from 'mocha';
import * as sinon from 'sinon';
import * as cmr from '../../app/util/cmr';

type CmrMethodName = 'cmrGetBase' | 'fetchPost' | 'cmrPostBase' | 'getCollectionsByIds' | 'getVariablesByIds' | 'getVariablesForCollection' | 'queryGranulesForCollection' | 'belongsToGroup' | 'cmrApiConfig';

/**
 * Replace a function in the `cmr` module with a given function. This is needed because
 * `replay` does not handle POSTs to the CMR correctly.
 *
 * @param functionName - The name of the function to be stubbed
 * @param response - The function that should run, or object that should be returned
 */
function stubCmr(functionName: CmrMethodName, response: Function | object): void {
  sinon.stub(cmr, functionName)
    .callsFake(async function () {
      if (typeof response === 'object') {
        return response;
      }
      return response();
    });
}

/**
 * Remove a stub from the `cmr` module
 *
 * @param functionName - The name of the function to reset
 */
function unStubCmr(functionName: string): void {
  if (cmr[functionName].restore) cmr[functionName].restore();
}

/**
 * Adds before / after hooks in mocha to replace a function in the
 * `cmr` module with a function that generates the given response
 *
 * Example: (`cmrPostBase` returns a 400 status with error message)
 * ```
* hookCmr('cmrPostBase',
  { status: 400,
    data: { errors: ['Corrupt zip file'] }
  });
 * ```
 * @param functionName - The name of the function to stub
 * @param response - The desired response
 */
export default function hookCmr(functionName: CmrMethodName, response: Function | object): void {
  before(async function () {
    stubCmr(functionName, response);
  });
  after(async function () {
    unStubCmr(functionName);
  });
}
