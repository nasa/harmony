import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { ECR } from '../util/container-registry';
import { hasCookieSecret } from '../util/cookie-secret';
import { getEdlGroupInformation, validateUserIsInCoreGroup } from '../util/edl-api';
import { exec } from 'child_process';
import * as path from 'path';
import util from 'util';
import { truncateString } from '@harmony/util/string';
import db from '../util/db';
import env from '../util/env';
import { getRequestRoot } from '../util/url';
import { v4 as uuid } from 'uuid';
import ServiceDeployment, { setStatusMessage, getDeploymentById, getDeployments, ServiceDeploymentStatus } from '../models/service-deployment';
import { keysToLowerCase } from '../util/object';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const asyncExec = util.promisify(require('child_process').exec);

/**
 * Compute the map of services to tags. Harmony core services are excluded.
 * @returns The map of canonical service names to image tags.
 */
export function getImageTagMap(): {} {
  const unsortedImageMap = {};
  const deployedServices = env.locallyDeployedServices.split(',');
  deployedServices.push('query-cmr');
  for (const v of Object.keys(process.env)) {
    if (v.endsWith('_IMAGE')) {
      const serviceName = v.slice(0, -6).toLowerCase().replaceAll('_', '-');
      // add in any services that are deployed in the environment
      if (deployedServices.includes(serviceName)) {
        const image = process.env[v];
        const match = image.match(/.*:(.*)/);
        if (match) {
          const tag = match[1] || '';
          unsortedImageMap[serviceName] = tag;
        }
      }
    }
  }

  const sortedImageMap = Object.keys(unsortedImageMap).sort().reduce((acc, key) => ({
    ...acc,
    [key]: unsortedImageMap[key],
  }), {});


  return sortedImageMap;
}

export interface EcrImageNameComponents {
  registryId: string;
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

  const [_, host, region, repository, tag] = match;
  const registryId = host.split('.')[0]; // the AWS account ID

  return {
    registryId,
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
    const { region, repository, registryId } = nameComponents;
    let endpoint = `https://ecr.${region}.amazonaws.com`;
    if (env.useLocalstack === true) {
      endpoint = `http://${env.localstackHost}:4566`;
    }
    const ecr = new ECR({
      region,
      endpoint,
    });
    if (! await ecr.describeImage(repository, tag, registryId)) {
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
 * Returns the values of the enabled and message fields of the service_deployment table.
 * @returns An object containing the boolean value of the enabled field and the message string
 */
async function getEnabledAndMessage(): Promise<{ enabled: boolean, message: string }> {
  let enabled = true;
  let message = '';
  let results = null;
  await db.transaction(async (tx) => {
    results = await tx('service_deployment').select('enabled', 'message');
  });

  if (results[0].enabled === 0 || results[0].enabled === false) {
    enabled = false;
  }
  [{ message }] = results;

  return { enabled, message };
}

/**
 * Set the enabled to true in service_deployment table
 */
export async function enableServiceDeployment(message: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx('service_deployment')
      .update({ enabled: true, message: truncateString(message, 4096) });
  });
}

/**
 * Acquire the service deployment lock, i.e. set the enabled to false in service_deployment table.
 * If the enabled value is already false, return false to indicate unable to acquire the lock.
 * @returns a Promise of boolean to indicate if the lock is successfully acquired.
 */
async function acquireServiceDeploymentLock(message: string): Promise<boolean> {
  let results = null;
  await db.transaction(async (tx) => {
    results = await tx('service_deployment')
      .where('enabled', true)
      .update({ enabled: false, message: message })
      .returning('enabled');
  });

  if (results[0] === undefined) {
    return false;
  }
  return true;
}

/**
 * Validate that the service deployment is enabled
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns A Promise containing `true` if the tagged image is reachable, `false` otherwise
 */
async function validateServiceDeploymentIsEnabled(
  req: HarmonyRequest,
  res: Response,
): Promise<boolean> {
  const { enabled, message } = await getEnabledAndMessage();
  if (!enabled) {
    res.statusCode = 423;
    res.send(`Service deployment is disabled. Reason: ${message}.`);
    return false;
  }

  return enabled;
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
 * Validate that the user is in the deployers or the core permissions group
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns A Promise containing `true` if the user is in either group, `false` otherwise
 */
async function validateUserIsInDeployerOrCoreGroup(
  req: HarmonyRequest, res: Response,
): Promise<boolean> {
  const { hasCorePermissions, isServiceDeployer } = await getEdlGroupInformation(
    req.user, req.context.logger,
  );

  if (!isServiceDeployer && !hasCorePermissions) {
    res.statusCode = 403;
    res.send(`User ${req.user} does not have permission to access this resource`);
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
    const message = 'A tag name may contain lowercase and uppercase characters, digits, ' +
      'underscores, periods and dashes. A tag name may not start with a period or a dash and ' +
      'may contain a maximum of 128 characters.';
    return message;
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
 * Verify that the requested service deployment status is one of the valid statuses
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns a Promise containing `true` if the status is valid, `false` otherwise
 */
async function validateStatusForListServiceRequest(
  req: HarmonyRequest, res: Response,
): Promise<boolean> {
  let { status } = req.query;
  // only check the status if it is actually passed in - no status is a valid choice if the user
  // wants results for any status
  if (status) {
    status = status.toString().toLowerCase();
    const validStatuses = Object.values(ServiceDeploymentStatus).map((val) => JSON.stringify(val));
    if (!validStatuses.includes(`"${status}"`)) {
      const validString = validStatuses.join(',');
      res.statusCode = 400;
      res.send(`"${status}" is not a valid deployment status. Valid statuses are [${validString}]`);
      return false;
    }
  }

  return true;
}

/**
 * Verify that the given state in the request body is either true or false
 * @param req - The request object
 * @param res  - The response object - will be used to send an error if the validation fails
 * @returns a Promise containing `true` if the state is valid in the request body, `false` otherwise
 */
async function validateDeploymentState(
  req: HarmonyRequest, res: Response,
): Promise<boolean> {
  if ((!req.body || req.body.enabled === undefined)) {
    res.statusCode = 400;
    res.send('\'enabled\' is a required body parameter');
    return false;
  } else if (req.body.enabled !== true && req.body.enabled !== false) {
    res.statusCode = 400;
    res.send('\'enabled\' can only take value of true or false');
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
  if (! await validateUserIsInDeployerOrCoreGroup(req, res)) return;

  const imageMap = getImageTagMap();

  const sortedImageMap = Object.keys(imageMap).sort().reduce((acc, key) => ({
    ...acc,
    [key]: imageMap[key],
  }), {});

  res.statusCode = 200;
  res.send(sortedImageMap);
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
    validateUserIsInDeployerOrCoreGroup,
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
 * @param service  - The name of the service to deploy
 * @param tag  - The service image tag to deploy
 * @param deploymentId  - The deployment id
 */
export async function execDeployScript(
  req: HarmonyRequest, service: string, tag: string, deploymentId: string,
): Promise<void> {
  const currentPath = __dirname;
  const cicdDir = path.join(currentPath, '../../../../../harmony-ci-cd');

  req.context.logger.info(`Execute script: ./bin/exec-deploy-service ${service} ${tag}`);
  const command = `./bin/exec-deploy-service ${service} ${tag}`;
  const options = {
    cwd: cicdDir,
  };

  exec(command, options, async (error, stdout, _stderr) => {
    const lines = stdout.split('\n');
    if (error) {
      req.context.logger.error(`Error executing script: ${error.message}`);
      lines.forEach(line => {
        req.context.logger.info(`Failed script output: ${line}`);
      });
      await db.transaction(async (tx) => {
        await setStatusMessage(tx,
          deploymentId,
          'failed',
          `Failed service deployment for deploymentId: ${deploymentId}. Error: ${error.message}`);
      });
    } else {
      lines.forEach(line => {
        req.context.logger.info(`Script output: ${line}`);
      });
      // only re-enable the service deployment on successful deployment
      await enableServiceDeployment(`Re-enable service deployment after successful deployment: ${deploymentId}`);
      await db.transaction(async (tx) => {
        await setStatusMessage(tx, deploymentId, 'successful', 'Deployment successful');
      });
    }
  });
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
    validateUserIsInDeployerOrCoreGroup,
    validateServiceDeploymentIsEnabled,
    validateTagPresent,
    validateServiceExists,
    validateTag,
    validateTaggedImageIsReachable,
  ];

  for (const validation of validations) {
    if (! await validation(req, res)) return;
  }

  const urlRoot = getRequestRoot(req);
  const deploymentId = uuid();
  const message = `Locked for service deployment: ${urlRoot}/service-deployment/${deploymentId}`;
  const lockAcquired = await acquireServiceDeploymentLock(message);
  if (lockAcquired === false) {
    res.statusCode = 423;
    const result = await getEnabledAndMessage();
    const msg = `Unable to acquire service deployment lock. Reason: ${result.message}. Try again later.`;
    res.send(msg);
    return;
  }

  const { service } = req.params;
  const { tag } = req.body;

  const deployment = new ServiceDeployment({
    deployment_id: deploymentId,
    username: req.user,
    service: service,
    tag: tag,
    status: 'running',
    message: 'Deployment in progress',
  });

  await db.transaction(async (tx) => {
    await deployment.save(tx);
  });

  module.exports.execDeployScript(req, service, tag, deploymentId);
  res.statusCode = 202;
  res.send({
    'tag': tag,
    'statusLink': `${urlRoot}/service-deployment/${deploymentId}`,
  });
}

/**
 * Get the current enable/disable state of service image tag update endpoint
 * @param req - The request object
 * @param res  - The response object
 * @param _next  - The next middleware in the chain
 */
export async function getServiceImageTagState(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  if (!hasCookieSecret(req) && ! await validateUserIsInDeployerOrCoreGroup(req, res)) return;

  const { enabled, message } = await getEnabledAndMessage();
  res.statusCode = 200;
  res.send({ 'enabled': enabled, 'message': message });
}

/**
 * Set the enabled flag of service image tag update endpoint to the given value
 * @param req - The request object
 * @param res  - The response object
 */
export async function setServiceImageTagState(
  req: HarmonyRequest, res: Response,
): Promise<void> {
  const validations = [
    validateUserIsInCoreGroup,
    validateDeploymentState,
  ];

  for (const validation of validations) {
    if (! await validation(req, res)) return;
  }

  const { enabled, message } = req.body;
  let deploymentMsg = '';
  if (enabled === true) {
    deploymentMsg = message ? message : `Manually enabled by ${req.user}`;
    await enableServiceDeployment(deploymentMsg);
  } else {
    // disable service deployment
    deploymentMsg = message ? message : `Manually disabled by ${req.user}`;
    const lockAcquired = await acquireServiceDeploymentLock(deploymentMsg);
    if (lockAcquired === false) {
      const result = await getEnabledAndMessage();
      res.statusCode = 423;
      res.send(`Unable to acquire service deployment lock. Reason: ${result.message}. Try again later.`);
      return;
    }
  }

  res.statusCode = 200;
  res.send({ 'enabled': enabled, message: deploymentMsg });
}

/**
 * Get the service deployment for the given deployment id
 * @param req - The request object
 * @param res  - The response object
 * @param _next  - The next middleware in the chain
 */
export async function getServiceDeployment(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  if (! await validateUserIsInDeployerOrCoreGroup(req, res)) return;

  const { id } = req.params;
  let deployment: ServiceDeployment;
  try {
    await db.transaction(async (tx) => {
      deployment = await getDeploymentById(tx, id);
    });
  } catch (e) {
    req.context.logger.error(`Caught exception: ${e}`);
    deployment = undefined;
  }

  if (deployment === undefined) {
    res.statusCode = 404;
    res.send({ 'error': 'Deployment does not exist' });
    return;
  }

  res.statusCode = 200;
  res.send(deployment.serialize());
}

/**
 * Get the service deployments with optional filters applied
 * @param req - The request object
 * @param res  - The response object
 * @param _next  - The next middleware in the chain
 */
export async function getServiceDeployments(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const validations = [
    validateUserIsInDeployerOrCoreGroup,
    validateStatusForListServiceRequest,
  ];

  for (const validation of validations) {
    if (! await validation(req, res)) return;
  }
  try {
    await db.transaction(async (tx) => {
      const queryLowerCase = keysToLowerCase(req.query);
      if (queryLowerCase.status) {
        queryLowerCase.status = queryLowerCase.status.toString().toLowerCase();
      }
      const deployments = await getDeployments(tx, queryLowerCase.status, queryLowerCase.service);
      res.statusCode = 200;
      res.send(deployments.map((deployment: ServiceDeployment) => deployment.serialize()));
    });
  } catch (e) {
    req.context.logger.error(`Caught exception: ${e}`);
    next(e);
  }
}