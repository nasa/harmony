import { before, after } from 'mocha';
import * as sinon from 'sinon';
import { ForbiddenError } from '../../app/util/errors';
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
  let userIdRequestStub;
  before(async function () {
    clientCredentialsStub = sinon.stub(edl, 'getClientCredentialsToken')
      .callsFake(async () => 'client-token');
    userIdRequestStub = sinon.stub(edl, 'getUserIdRequest')
      .callsFake(async () => username);
  });
  after(async function () {
    if (clientCredentialsStub.restore) clientCredentialsStub.restore();
    if (userIdRequestStub.restore) userIdRequestStub.restore();
  });
}

/**
 * Adds before / after hooks in mocha to replace calls to EDL token interaction
 * to throw an error
 */
export function hookEdlTokenAuthenticationError(): void {
  let clientCredentialsStub;
  let cachedRequestStub;

  before(async function () {
    const error = new ForbiddenError();
    clientCredentialsStub = sinon.stub(edl, 'getClientCredentialsToken').throws(error);
    cachedRequestStub = sinon.stub(edlAuth, 'cachedGetUserIdRequest').throws(error);
  });

  after(async function () {
    if (clientCredentialsStub.restore) clientCredentialsStub.restore();
    if (cachedRequestStub.restore) cachedRequestStub.restore();
  });
}