import { before, after } from 'mocha';
import * as sinon from 'sinon';
import { UnauthorizedError } from '../../app/util/errors';
import * as edl from '../../app/util/edl-api';
import * as edlAuth from '../../app/middleware/earthdata-login-token-authorizer';

/**
 * Adds before / after hooks in mocha to replace calls to EDL token interaction
 * to automatically set the username
 *
 * @param username - The name of the user to return for the provided token
 */
export function hookEdlTokenAuthentication(username: string): void {
  let clientCredentialsStub;
  let tokenCacheStub;
  before(async function () {
    clientCredentialsStub = sinon.stub(edl, 'getClientCredentialsToken')
      .callsFake(async () => 'client-token');
    tokenCacheStub = sinon.stub(edlAuth.tokenCache, 'fetch')
      .callsFake(async () => username);
  });
  after(async function () {
    if (clientCredentialsStub.restore) clientCredentialsStub.restore();
    if (tokenCacheStub.restore) tokenCacheStub.restore();
  });
}

/**
 * Adds before / after hooks in mocha to replace calls to EDL token interaction
 * to throw an error
 */
export function hookEdlTokenAuthenticationError(): void {
  let clientCredentialsStub;
  let tokenCacheStub;

  before(async function () {
    const error = new UnauthorizedError();
    clientCredentialsStub = sinon.stub(edl, 'getClientCredentialsToken').throws(error);
    tokenCacheStub = sinon.stub(edlAuth.tokenCache, 'fetch').throws(error);
  });

  after(async function () {
    if (clientCredentialsStub.restore) clientCredentialsStub.restore();
    if (tokenCacheStub.restore) tokenCacheStub.restore();
  });
}
