import { Response } from 'express';
import HarmonyRequest from '../models/harmony-request';
import * as services from '../models/services/index';
import env from '../util/env';
import _ from 'lodash';

/**
 * Express.js handler that handls deployment callback message for deploying a service.
 * This function will only be called when the service deployment is successful.
 * Update the harmony server configuration for the new service image and service queue urls in the request.
 * The callback_message in request body is in JSON. It has three fields:
 *  deployService - name of the harmony service
 *  image - full image url with tag for the deployed service
 *  serviceQueueUrls - a list contains the service image to queue url mapping as defined in HarmonyEnv class.
 * Here is an example:
 *  \{"deployService":"giovanni-adapter",
 *   "image":"123456.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/giovanni-adapter:latest",
 *   "serviceQueueUrls":"[\"123456.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/giovanni-adapter:latest.....\"]"\}
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
export default async function handleCallbackMessage(req: HarmonyRequest, res: Response): Promise<void> {
  const logger = req.context.logger.child({ component: 'snsHandler.handleCallbackMessage' });
  const headerSecret = req.headers['cookie-secret'];
  const secret = process.env.COOKIE_SECRET;
  logger.info(`handleCallbackMessage: ${JSON.stringify(req.body)}`);

  if (headerSecret === secret) {
    const { deployService, image, serviceQueueUrls } = req.body;
    const serviceImageEnv = _.camelCase(`${deployService.replace(/-/g, '_')}_image`);
    const serviceQueueUrlsEnv = _.camelCase(`${deployService.replace(/-/g, '_')}_service_queue_urls`);

    env[serviceImageEnv] = image;
    env[serviceQueueUrlsEnv] = serviceQueueUrls;
    env.servicesYml = undefined;
    services.resetServiceConfigs();
  } else {
    logger.error('You do not have permission to call deployment-callback endpoint');
    res.statusCode = 401;
    res.send('You do not have permission to call deployment-callback endpoint');
    return;
  }

  res.send('OK');
}
