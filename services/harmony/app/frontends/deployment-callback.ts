import { Response } from 'express';
import HarmonyRequest from '../models/harmony-request';
import * as services from '../models/services/index';
import env from '../util/env';
import _, { get as getIn, partial } from 'lodash';


/**
 * Express.js handler that handls deployment callback message for deploying a service.
 * This function will only be called when the service deployment is successful.
 * Update the harmony server configuration for the new service image and service queue urls in the request.
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
export default async function handleCallbackMessage(req: HarmonyRequest, res: Response): Promise<void> {
  const logger = req.context.logger.child({ component: 'snsHandler.handleCallbackMessage' });
  const { deployService, tag, image, serviceQueueUrls, status } = req.body;
  logger.info(`handleCallbackMessage: ${JSON.stringify(req.body)}`);

  const serviceImageEnv = _.camelCase(`${deployService.replace(/-/g, '_')}_image`);
  const serviceQueueUrlsEnv = _.camelCase(`${deployService.replace(/-/g, '_')}_service_queue_urls`);

  env[serviceImageEnv]=image;
  env[serviceQueueUrlsEnv]=serviceQueueUrls;
  env.servicesYml=undefined;
  services.resetServiceConfigs();

  res.send('OK');
}
