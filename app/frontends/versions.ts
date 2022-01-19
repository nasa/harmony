import { Response } from 'express';
import { Logger } from 'winston';
import { inEcr, sanitizeImage } from '../util/string';
import { defaultContainerRegistry, ECR } from '../util/container-registry';
import { toISODateTime } from '../util/date';
import { getServiceConfigs } from '../models/services';
import { ServiceConfig } from '../models/services/base-service';
import HarmonyRequest from '../models/harmony-request';
import { TurboServiceParams } from '../models/services/turbo-service';

interface ServiceVersion {
  name: string;
  images: ImageInfo[];
}

interface ImageInfo {
  image: string;
  tag: string;
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
  service: ServiceConfig<TurboServiceParams>, ecr: ECR, logger: Logger,
): Promise<ServiceVersion> {
  const imagesInSteps = service.steps?.map((s) => s.image) || [];
  if (imagesInSteps.length === 0) {
    logger.warn(`${service.name} does not have any steps configured for a turbo service. Likely a misconfiguration in services.yml.`);
  }
  const images = [];
  for (const image of imagesInSteps) {
    const tagSeparatorIndex = image.lastIndexOf(':');
    const imageName = sanitizeImage(image.substring(0, tagSeparatorIndex));
    const imageTag = image.substring(tagSeparatorIndex + 1, image.length);
    const imageInfo: ImageInfo = {
      image: imageName,
      tag: imageTag,
    };

    if (inEcr(image)) {
      try {
        const { lastUpdated, imageDigest } = await ecr.describeImage(imageName, imageTag);
        imageInfo.lastUpdated = toISODateTime(lastUpdated);
        imageInfo.imageDigest = imageDigest;
      } catch (e) {
        logger.warn('Failed to retrieve image information from ECR');
        logger.warn(e);
      }
    }
    images.push(imageInfo);
  }

  return { name: service.name, images };
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
  const turboServices = await Promise.all((getServiceConfigs() as ServiceConfig<TurboServiceParams>[])
    .filter((s) => s.type.name === 'turbo')
    .map((service) => getServiceForDisplay(service, ecr, logger)));
  res.json(turboServices);
}
