import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { getEdlGroupInformation } from '../util/edl-api';
import { exec } from 'child_process';
import * as path from 'path';

const harmonyTaskServices = [
  'work-item-scheduler',
  'work-item-updater',
  'work-reaper',
  'work-failer',
];

const successfulStatus = 'successful';

/**
 * Compute the map of services to tags. Harmony core services are excluded.
 * @returns The map of canonical service names to image tags.
 */
function getImageTagMap(): {} {
  const imageMap = {};
  for (const v of Object.keys(process.env)) {
    if (v.endsWith('_IMAGE')) {
      const serviceName = v.slice(0, -6).toLowerCase().replaceAll('_', '-');
      // add in any services that are not Harmony core task services
      if (!harmonyTaskServices.includes(serviceName)) {
        const image = process.env[v];
        const match = image.match(/.*:(.*)/);
        if (match) {
          const tag = match[1] || '';
          imageMap[serviceName] = tag;
        }
      }
    }
  }

  return imageMap;
}

/**
 * Validate that the service exists
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns A Promise containing `true` if the service exists, `false` otherwise
 */
async function validateServiceExists(
  res: Response, service: string,
): Promise<boolean> {
  const imageMap = getImageTagMap();
  if (!imageMap[service]) {
    res.statusCode = 404;
    const message = `Service ${service} does not exist.\nThe existing services and their images are\n${JSON.stringify(imageMap, null, 2)}`;
    res.send(message);
    return false;
  }
  return true;
}

/**
 * Validate that the user is in the deployers or the admin group
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns A Promise containing `true` if the user in in either group, `false` otherwise
 */
async function validateUserIsInDeployerOrAdminGroup(
  req: HarmonyRequest, res: Response,
): Promise<boolean> {
  const { isAdmin, isServiceDeployer } = await getEdlGroupInformation(
    req.user, req.context.logger,
  );

  if (!isServiceDeployer && !isAdmin) {
    res.statusCode = 403;
    res.send(`User ${req.user} is not in the service deployers or admin EDL groups`);
    return false;
  }
  return true;
}

/**
 * Verify that the given tag is valid. Send an error if it is not.
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns a Promise containing `true` if the tag is valid, false if not
 */
async function validateTag(
  req: HarmonyRequest, res: Response,
): Promise<boolean> {
  const { tag } = req.body;
  // See https://docs.docker.com/engine/reference/commandline/image_tag/
  const tagRegex = /^[a-zA-Z\d_][a-zA-Z\d\-_.]{0,127}$/;
  if (!tagRegex.test(tag)) {
    res.statusCode = 400;
    res.send('A tag name may contain lowercase and uppercase characters, digits, underscores, periods and dashes. A tag name may not start with a period or a dash and may contain a maximum of 128 characters.');
    return false;
  }
  return true;
}

/**
 * Get a map of the canonical service names to their current tags
 * @param req - The request object
 * @param res  - The response object
 * @param _next  - The next middleware in the chain
 */
export async function getServiceImageTags(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  if (! await validateUserIsInDeployerOrAdminGroup(req, res)) return;

  const imageMap = getImageTagMap();
  res.statusCode = 200;
  res.send(imageMap);
}

/**
 * Get the current image tag for the given service
 * @param req - The request object
 * @param res  - The response object
 * @param _next  - The next middleware in the chain
 */
export async function getServiceImageTag(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  if (! await validateUserIsInDeployerOrAdminGroup(req, res)) return;
  const { service } = req.params;
  if (! await validateServiceExists(res, service)) return;

  const imageTagMap = getImageTagMap();
  const tag = imageTagMap[service];
  res.statusCode = 200;
  res.send({ 'tag': tag });
}

/**
 *  Execute the deploy service script asynchronously
 *
 * @param req - The request object
 * @param res  - The response object
 * @param service  - The name of the service to deploy
 * @param tag  - The service image tag to deploy
 * @returns a Promise containing the deployment status
 */
export async function execDeployScript(
  req: HarmonyRequest, res: Response, service: string, tag: string,
): Promise<string> {
  const currentPath = __dirname;
  const cicdDir = path.join(currentPath, '../../../../../harmony-ci-cd');

  req.context.logger.info(`Execute script: ./bin/exec-deploy-service ${service} ${tag}`);
  const command = `./bin/exec-deploy-service ${service} ${tag}`;
  const options = {
    cwd: cicdDir,
  };

  exec(command, options, (error, stdout, stderr) => {
    if (error) {
      req.context.logger.error(`Error executing script: ${error.message}`);
      return 'failed';
    }
    const commandOutput: string = stdout.trim();
    const commandErr: string = stderr.trim();
    req.context.logger.info(`Script output: ${commandOutput}`);
    if (commandErr) {
      req.context.logger.error(`Script error: ${commandErr}`);
    }
  });

  return successfulStatus;
}

/**
 *  Update the tag for the given service
 *
 * @param req - The request object
 * @param res  - The response object
 * @param _next  - The next middleware in the chain
 */
export async function updateServiceImageTag(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  if (! await validateUserIsInDeployerOrAdminGroup(req, res)) return;

  const { service } = req.params;
  if (! await validateServiceExists(res, service)) return;
  if (!req.body || !req.body.tag) {
    res.statusCode = 400;
    res.send('\'tag\' is a required body parameter');
    return;
  }

  if (! await validateTag(req, res)) return;

  const { tag } = req.body;

  const status = await module.exports.execDeployScript(req, res, service, tag);
  if (status == successfulStatus) {
    res.statusCode = 201;
    res.send({ 'tag': tag });
  }
}
