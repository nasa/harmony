import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { ECR } from '../util/container-registry';
import { getEdlGroupInformation } from '../util/edl-api';
import { exec } from 'child_process';
import * as path from 'path';
import util from 'util';
import env from '../util/env';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const asyncExec = util.promisify(require('child_process').exec);


export const harmonyTaskServices = [
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
export function getImageTagMap(): {} {
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

export interface EcrImageNameComponents {
  host: string;
  region: string;
  repository: string;
  tag: string;
}

/**
 * Break an ECR image name down into its components
 * @param name - The full name of the image including host/path
 * @returns the components of the image name
 */
export function ecrImageNameToComponents(name: string): EcrImageNameComponents {
  const componentRegex = /^(.*?\.dkr\.ecr\.(.*?)\.amazonaws\.com)\/(.*):(.*)$/;
  const match = name.match(componentRegex);
  if (!match) return null;

  const [ _, host, region, repository, tag ] = match;

  return {
    host,
    region,
    repository,
    tag,
  };
}

/**
 * Validate that the tagged image is reachable
 * @param res - The response object - will be used to send an error if the validation fails
 * @param url - The URL of the image including tag
 * @returns A Promise containing `true` if the tagged image is reachable, `false` otherwise
 */
async function validateTaggedImageIsReachable(
  req: HarmonyRequest,
  res: Response,
): Promise<boolean> {
  const { service } = req.params;
  const { tag } = req.body;
  const envVarName = service.toUpperCase().replaceAll('-', '_') + '_IMAGE';
  const existingName = process.env[envVarName];
  const updatedName = existingName.replace(/:.*?$/, `:${tag}`);

  const nameComponents = ecrImageNameToComponents(existingName);
  let isReachable = true;

  if (nameComponents) {
    // use the AWS CLI to check
    const { region, repository } = nameComponents;
    let endpoint = `https://ecr.${region}.amazonaws.com`;
    if (env.useLocalstack === true) {
      endpoint = `http://${env.localstackHost}:4566`;
    }
    const ecr = new ECR({
      region,
      endpoint,
    });
    if (! await ecr.describeImage(repository, tag)) {
      isReachable = false;
    }
  } else {
    // use the docker ClI to check
    try {
      const { err } = await exports.asyncExec(`docker manifest inspect ${updatedName}`);
      if (err && err.code != 0) {
        isReachable = false;
      }
    } catch (e) {
      isReachable = false;
    }
  }
  if (!isReachable) {
    res.statusCode = 404;
    res.send(`${updatedName} is unreachable`);
  }

  return isReachable;
}

/**
 * Returns an error message if the service does not exist
 * @param service - the canonical name of the service
 */
export function checkServiceExists(service: string): string {
  const imageMap = getImageTagMap();
  if (!imageMap[service]) {
    return `Service ${service} does not exist.\nThe existing services and their images are\n${JSON.stringify(imageMap, null, 2)}`;
  }

  return null;
}

/**
 * Validate that the service exists
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns A Promise containing `true` if the service exists, `false` otherwise
 */
async function validateServiceExists(
  req: HarmonyRequest,
  res: Response,
): Promise<boolean> {
  const { service } = req.params;
  const errMsg = checkServiceExists(service);
  if (errMsg) {
    res.statusCode = 404;
    res.send(errMsg);
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
 * Returns an error message if a tag does not have the correct form.
 * See https://docs.docker.com/engine/reference/commandline/image_tag/
 *
 * @param tag - The image tag to check
 * @returns An error message if the tag is not valid, null otherwise
 */
export function checkTag(tag: string): string {
  // See https://docs.docker.com/engine/reference/commandline/image_tag/
  const tagRegex = /^[a-zA-Z\d_][a-zA-Z\d\-_.]{0,127}$/;
  if (!tagRegex.test(tag)) {
    return 'A tag name may contain lowercase and uppercase characters, digits, underscores, periods and dashes. A tag name may not start with a period or a dash and may contain a maximum of 128 characters.';
  }
  return null;
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
  const errMsg = checkTag(tag);

  if (errMsg) {
    res.statusCode = 400;
    res.send(errMsg);
    return false;
  }
  return true;
}

/**
 * Verify that a tag is present in the request body
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns a Promise containing `true` if the tag is present in the request body, `false` otherwise
 */
async function validateTagPresent(
  req: HarmonyRequest, res: Response,
): Promise<boolean> {
  if (!req.body || !req.body.tag) {
    res.statusCode = 400;
    res.send('\'tag\' is a required body parameter');
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
  const validations = [
    validateUserIsInDeployerOrAdminGroup,
    validateServiceExists,
  ];

  for (const validation of validations) {
    if (! await validation(req, res)) return;
  }

  const { service } = req.params;
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

  const validations = [
    validateUserIsInDeployerOrAdminGroup,
    validateTagPresent,
    validateServiceExists,
    validateTag,
    validateTaggedImageIsReachable,
  ];

  for (const validation of validations) {
    if (! await validation(req, res)) return;
  }

  const { service } = req.params;
  const { tag } = req.body;

  const status = await module.exports.execDeployScript(req, res, service, tag);
  if (status == successfulStatus) {
    res.statusCode = 201;
    res.send({ 'tag': tag });
  }
}
