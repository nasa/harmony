import { before, after } from 'mocha';
import * as sinon from 'sinon';
import { ForbiddenError } from 'util/errors';
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
    clientCredentialsStub = sinon.stub(edlAuth, 'getClientCredentialsToken')
      .callsFake(async () => 'client-token');
    userIdRequestStub = sinon.stub(edlAuth, 'getUserIdRequest')
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
  let userIdRequestStub;
  before(async function () {
    const error = new ForbiddenError();
    clientCredentialsStub = sinon.stub(edlAuth, 'getClientCredentialsToken').throws(error);
    userIdRequestStub = sinon.stub(edlAuth, 'getUserIdRequest').throws(error);
  });
  after(async function () {
    if (clientCredentialsStub.restore) clientCredentialsStub.restore();
    if (userIdRequestStub.restore) userIdRequestStub.restore();
  });
}
