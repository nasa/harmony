import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { getEdlGroupInformation } from '../util/edl-api';

const harmonyTaskServices = [
  'work-item-scheduler',
  'work-item-updater',
  'work-reaper',
  'work-failer',
];

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

  // TODO HARMONY-1701 run deployment script here

  res.statusCode = 201;
  res.send({ 'tag': tag });
}
