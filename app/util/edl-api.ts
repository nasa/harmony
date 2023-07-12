import * as axios from 'axios';
import { ForbiddenError } from './errors';
import { Logger } from 'winston';
import env from './env';
import HarmonyRequest from '../models/harmony-request';

const edlUserRequestUrl = `${env.oauthHost}/oauth/tokens/user`;
const edlClientCredentialsUrl = `${env.oauthHost}/oauth/token`;
const edlUserGroupsBaseUrl = `${env.oauthHost}/api/user_groups/groups_for_user`;
const edlVerifyUserEulaUrl = (username: string, eulaId: string): string =>
  `${env.oauthHost}/api/users/${username}/verify_user_eula?eula_id=${eulaId}`;

const clientCredentialsData = {
  params: { grant_type: 'client_credentials' },
  auth: {
    username: env.oauthClientId,
    password: env.oauthPassword,
  },
};

/**
 * Makes a request to the EDL users endpoint to validate a token and return the user ID
 * associated with that token.
 *
 * @param clientToken - The harmony client token
 * @param userToken - The user's token
 * @param logger - The logger associated with the request
 * @returns the username associated with the token
 * @throws ForbiddenError if the token is invalid
 */
export async function getUserIdRequest(clientToken: string, userToken: string, logger: Logger)
  : Promise<string> {
  try {
    const response = await axios.default.post(
      edlUserRequestUrl,
      null,
      {
        params: {
          client_id: env.oauthClientId,
          token: userToken,
        },
        headers: { authorization: `Bearer ${clientToken}` },
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
 * Returns the bearer token to use in all EDL requests from Harmony
 * @param logger - The logger associated with the request
 */
export async function getClientCredentialsToken(logger: Logger): Promise<string> {
  try {
    const response = await axios.default.post(edlClientCredentialsUrl, null, clientCredentialsData);
    return response.data.access_token;
  } catch (e) {
    logger.error('Failed to get client credentials for harmony user.');
    logger.error(e);
    throw new ForbiddenError();
  }
}

/**
 * Returns the groups to which a user belongs
 *
 * @param username - The EDL username
 * @param userToken - The user's token
 * @param logger - The logger associated with the request
 * @returns the groups to which the user belongs
 */
async function getUserGroups(username: string, userToken: string, logger: Logger)
  : Promise<string[]> {
  try {
    const response = await axios.default.get(
      `${edlUserGroupsBaseUrl}/${username}`, { headers: { Authorization: `Bearer ${userToken}` } },
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
}

/**
 * Returns the harmony relevant group information for a user with two keys isAdmin and isLogViewer.
 *
 * @param username - The EDL username
 * @param userToken - The user's token
 * @param logger - The logger associated with the request
 * @returns A promise which resolves to info about whether the user is an admin or log viewer
 */
export async function getEdlGroupInformation(username: string, userToken: string, logger: Logger)
  : Promise<EdlGroupMembership> {
  const groups = await getUserGroups(username, userToken, logger);
  let isAdmin = false;
  if (groups.includes(env.adminGroupId)) {
    isAdmin = true;
  }

  let isLogViewer = false;
  if (groups.includes(env.logViewerGroupId)) {
    isLogViewer = true;
  }

  return { isAdmin, isLogViewer };
}

/**
 * Helper function which returns true if the request is from an admin user
 * @param req - the harmony request
 */
export async function isAdminUser(req: HarmonyRequest): Promise<boolean> {
  const isAdmin = req.context.isAdminAccess ||
    (await getEdlGroupInformation(req.user, req.accessToken, req.context.logger)).isAdmin;
  return isAdmin;
}

export interface EdlUserEulaInfo {
  statusCode: number;
  error?: string;
  acceptEulaUrl?: string;
}

/**
 * Check the whether the user has accepted a EULA.
 *
 * @param username - The EDL username
 * @param eulaId - The id of the EULA (from the collection metadata)
 * @param userToken - The user's token
 * @returns A promise which resolves to info about whether the user has accepted a EULA,
 * and if not, where they can go to accept it
 */
export async function verifyUserEula(username: string, eulaId: string, userToken: string)
  : Promise<EdlUserEulaInfo> {
  let statusCode: number;
  let eulaResponse: { msg: string, error: string, accept_eula_url: string };
  try {
    const response = await axios.default.get(
      edlVerifyUserEulaUrl(username, eulaId), { headers: { Authorization: `Bearer ${userToken}` } },
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