import { Response } from 'express';
import { Logger } from 'winston';
import { inEcr, sanitizeImage } from 'app/util/string';
import { defaultContainerRegistry, ECR } from '../util/container-registry';
import { toISODateTime } from '../util/date';
import { getServiceConfigs } from '../models/services';
import { ServiceConfig } from '../models/services/base-service';
import HarmonyRequest from '../models/harmony-request';
import { ArgoServiceParams } from '../models/services/argo-service';
import env = require('../util/env');

interface ServiceVersion {
  name: string;
  image: string;
  tag: string;
  imagePullPolicy: string;
  imageDigest?: string;
  lastUpdated?: string;
}

/**
 * Returns an object with only the fields desired to display on the /versions endpoint.
 * For ECR images also display the digest and last updated time.
 *
 * @param service - The service whose version information is being displayed
 * @returns The version information for the service
 */
async function getServiceForDisplay(
  service: ServiceConfig<ArgoServiceParams>, ecr: ECR, logger: Logger,
): Promise<ServiceVersion> {
  const { image } = service.type.params;
  const imagePullPolicy = service.type.params.image_pull_policy || env.defaultImagePullPolicy;
  const tagSeparatorIndex = image.lastIndexOf(':');
  const imageName = sanitizeImage(image.substring(0, tagSeparatorIndex));
  const imageTag = image.substring(tagSeparatorIndex + 1, image.length);
  const serviceInfo: ServiceVersion = {
    name: service.name,
    image: imageName,
    tag: imageTag,
    imagePullPolicy,
  };

  if (inEcr(image)) {
    try {
      const { lastUpdated, imageDigest } = await ecr.describeImage(imageName, imageTag);
      serviceInfo.lastUpdated = toISODateTime(lastUpdated);
      serviceInfo.imageDigest = imageDigest;
    } catch (e) {
      logger.warn('Failed to retrieve image information from ECR');
      logger.warn(e);
    }
  }
  return serviceInfo;
}

/**
 * Express.js handler that returns the Harmony versions being used for all services
 *
 * Displays JSON with a list of all of the harmony services showing the service name,
 * the name of the image being used, and the tag.
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
export default async function getVersions(req: HarmonyRequest, res: Response): Promise<void> {
  const ecr = defaultContainerRegistry();
  const logger = req.context.logger.child({ component: 'versions.getVersions' });
  const argoServices = await Promise.all((getServiceConfigs() as ServiceConfig<ArgoServiceParams>[])
    .filter((s) => s.type.name === 'argo')
    .map((service) => getServiceForDisplay(service, ecr, logger)));
  res.json(argoServices);
}
