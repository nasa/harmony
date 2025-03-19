import * as axios from 'axios';
import { hasCookieSecret } from './cookie-secret';
import { ForbiddenError } from './errors';
import { Response } from 'express';
import env from './env';
import HarmonyRequest from '../models/harmony-request';
import { oauthOptions } from '../middleware/earthdata-login-oauth-authorizer';
import { ClientCredentials, AccessToken } from 'simple-oauth2';
import RequestContext from '../models/request-context';
import { Logger } from 'winston';

const edlUserRequestUrl = `${env.oauthHost}/oauth/tokens/user`;
const edlUserGroupsBaseUrl = `${env.oauthHost}/api/user_groups/groups_for_user`;
const edlVerifyUserEulaUrl = (username: string, eulaId: string): string =>
  `${env.oauthHost}/api/users/${username}/verify_user_eula?eula_id=${eulaId}`;

let oauth2: ClientCredentials;
let harmonyClientToken: AccessToken; // valid for 30 days

/**
 * Returns the bearer token to use in all EDL requests from Harmony
 * @param logger - The logger associated with the request
 * @returns The client bearer token
 */
export async function getClientCredentialsToken(logger: Logger): Promise<string> {
  try {
    if (oauth2 === undefined) {
      oauth2 = new ClientCredentials(oauthOptions);
    }
    if (harmonyClientToken === undefined || harmonyClientToken.expired()) {
      // There appears to be no way to pass in an `X-Request-Id` header with a call to `getToken`
      harmonyClientToken = await oauth2.getToken({});
    }
    return harmonyClientToken.token.access_token as string;
  } catch (e) {
    logger.error('Failed to get client credentials for harmony user.');
    logger.error(e);
    throw new ForbiddenError();
  }
}

/**
 * Makes a request to the EDL users endpoint to validate a token and return the user ID
 * associated with that token.
 *
 * @param context - Information related to the user's request
 * @param userToken - The user's token
 * @returns the username associated with the token
 * @throws ForbiddenError if the token is invalid
 */
export async function getUserIdRequest(context: RequestContext, userToken: string)
  : Promise<string> {
  const { logger } = context;
  try {
    const clientToken = await getClientCredentialsToken(context.logger);
    const response = await axios.default.post(
      edlUserRequestUrl,
      null,
      {
        params: {
          client_id: env.oauthClientId,
          token: userToken,
        },
        headers: { authorization: `Bearer ${clientToken}`, 'X-Request-Id': context.id },
      },
    );
    return response.data.uid;
  } catch (e) {
    logger.error('Failed to validate passed in bearer token.');
    logger.error(e);
    throw new ForbiddenError();
  }
}

/**
 * Returns the groups to which a user belongs
 *
 * @param context - Information related to the user's request
 * @param username - The EDL username
 * @returns the groups to which the user belongs
 */
async function getUserGroups(context: RequestContext, username: string)
  : Promise<string[]> {
  const { logger } = context;
  try {
    const clientToken = await getClientCredentialsToken(context.logger);
    const response = await axios.default.get(
      `${edlUserGroupsBaseUrl}/${username}`, { headers: { Authorization: `Bearer ${clientToken}`, 'X-Request-Id': context.id } },
    );
    const groups = response.data?.user_groups.map((group) => group.group_id) || [];
    return groups;
  } catch (e) {
    logger.error('Failed to retrieve groups for user.');
    logger.error(e);
    return [];
  }
}

export interface EdlGroupMembership {
  isAdmin: boolean;
  isLogViewer: boolean;
  isServiceDeployer: boolean;
  hasCorePermissions: boolean;
}

/**
 * Returns the harmony relevant group information for a user with two keys isAdmin and isLogViewer.
 *
 * @param context - Information related to the user's request
 * @param username - The EDL username
 * @returns A promise which resolves to info about whether the user is an admin, log viewer or service deployer,
 * and has core permissions (e.g. allowing user to access server configuration endpoints)
 */
export async function getEdlGroupInformation(context: RequestContext, username: string)
  : Promise<EdlGroupMembership> {

  if (!env.useEdlClientApp) {
    return { isAdmin: false, isLogViewer: false, isServiceDeployer: false, hasCorePermissions: false };
  }

  const groups = await getUserGroups(context, username);
  let isAdmin = false;
  if (groups.includes(env.adminGroupId)) {
    isAdmin = true;
  }

  let isLogViewer = false;
  if (groups.includes(env.logViewerGroupId)) {
    isLogViewer = true;
  }

  let isServiceDeployer = false;
  if (groups.includes(env.serviceDeployerGroupId)) {
    isServiceDeployer = true;
  }

  let hasCorePermissions = false;
  if (groups.includes(env.corePermissionsGroupId)) {
    hasCorePermissions = true;
  }

  return { isAdmin, isLogViewer, isServiceDeployer, hasCorePermissions };
}

/**
 * Helper function which returns true if the request is from an admin user
 * @param req - the harmony request
 */
export async function isAdminUser(req: HarmonyRequest): Promise<boolean> {
  if (!env.useEdlClientApp) return false;

  const isAdmin = req.context.isAdminAccess ||
    (await getEdlGroupInformation(req.context, req.user)).isAdmin;
  return isAdmin;
}

export interface EdlUserEulaInfo {
  statusCode: number;
  error?: string;
  acceptEulaUrl?: string;
}

/**
 * Check whether the user has accepted a EULA.
 *
 * @param context - Information related to the user's request
 * @param username - The EDL username
 * @param eulaId - The id of the EULA (from the collection metadata)
 * @returns A promise which resolves to info about whether the user has accepted a EULA,
 * and if not, where they can go to accept it
 */
export async function verifyUserEula(context: RequestContext, username: string, eulaId: string)
  : Promise<EdlUserEulaInfo> {
  let statusCode: number;
  let eulaResponse: { msg: string, error: string, accept_eula_url: string };
  try {
    const clientToken = await getClientCredentialsToken(context.logger);
    const response = await axios.default.get(
      edlVerifyUserEulaUrl(username, eulaId), { headers: { Authorization: `Bearer ${clientToken}`, 'X-Request-Id': context.id } },
    );
    eulaResponse = response.data;
    statusCode = response.status;
  } catch (e) {
    eulaResponse = e.response.data;
    statusCode = e.response.status;
  }
  return {
    statusCode,
    error: eulaResponse.error,
    acceptEulaUrl: eulaResponse.accept_eula_url,
  };
}

/**
 * Validate that the user is in the core permissions group
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns A Promise containing `true` if the user is in core permissions group, `false` otherwise
 */
export async function validateUserIsInCoreGroup(
  req: HarmonyRequest, res: Response,
): Promise<boolean> {
  // if request has cookie-secret header, it is in the core permissions group
  if (! hasCookieSecret(req)) {
    const { hasCorePermissions } = await getEdlGroupInformation(
      req.context, req.user,
    );

    if (!hasCorePermissions) {
      res.statusCode = 403;
      res.send(`User ${req.user} does not have permission to access this resource`);
      return false;
    }
  }

  return true;
}

/**
 * Returns true if EDL is up
 *
 * @param context - Information related to the user's request
 * @param username - The EDL username
 * @returns the groups to which the user belongs
 */
export async function isEdlHealthy(context: RequestContext): Promise<boolean> {
  const { logger } = context;
  try {
    const response = await axios.default.get(`${env.oauthHost}/home`);
    return response.status === 200;
  } catch (e) {
    logger.error('Failed to access EDL home page.');
    logger.error(e);
    return false;
  }
}