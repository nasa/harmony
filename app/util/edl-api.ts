import * as axios from 'axios';
import { ForbiddenError } from './errors';
import { Logger } from 'winston';
import env from './env';

const edlUserRequestUrl = `${env.oauthHost}/oauth/tokens/user`;
const edlClientCredentialsUrl = `${env.oauthHost}/oauth/token`;
const edlUserGroupsBaseUrl = `${env.oauthHost}/api/user_groups/groups_for_user`;

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
 */
async function getUserGroups(username: string, userToken: string, logger: Logger)
  : Promise<string[]> {
  try {
    const response = await axios.default.get(
      `${edlUserGroupsBaseUrl}/${username}`, { headers: { Authorization: `Bearer ${userToken}` } },
    );
    const { data } = response;
    console.log(`Groups before are ${JSON.stringify(data)}`);
    const groups = response.data?.user_groups.map((group) => group.group_id) || [];
    console.log(`Groups after are ${JSON.stringify(groups)}`);
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
 * Returns the harmony relevant group information for a user with two keys isAdmin and isLogViewer
 *
 */
export async function getEdlGroupInformation(username: string, userToken: string, logger: Logger)
  : Promise<EdlGroupMembership> {
  const groups = await getUserGroups(username, userToken, logger);
  console.log(`Groups are ${JSON.stringify(groups)}`);
  let isAdmin = false;
  if (groups.includes('9b359064-287f-411f-b2cc-ed4429676900')) {
    isAdmin = true;
  }

  let isLogViewer = false;
  if (groups.includes('0cf2a427-96cc-453e-ae44-e28dd0958738')) {
    isLogViewer = true;
  }

  return { isAdmin, isLogViewer };
}