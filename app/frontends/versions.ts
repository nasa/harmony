import { Response } from 'express';
import { getServiceConfigs } from '../models/services';
import { ServiceConfig } from '../models/services/base-service';
import HarmonyRequest from '../models/harmony-request';
import { ArgoServiceParams } from '../models/services/argo-service';
import env = require('../util/env');

interface ServiceVersion {
  name: string;
  image: string;
  tag: string;
  image_pull_policy: string;
}

/**
 * Removes AWS account ECR information or maven.earthdata.nasa.gov from the image name
 * since we may not want to expose that information.
 *
 * @param image The image name to sanitize
 * @returns the sanitized image name
 */
function sanitizeImage(image: string): string {
  return image
    .replace(/.*amazonaws.com\//, '')
    .replace(/.*earthdata.nasa.gov\//, '');
}

/**
 * Returns an object with only the fields desired to display on the /versions endpoint.
 * @param service The service whose version information is being displayed
 * @return The version information for the service
 */
function getServiceForDisplay(service: ServiceConfig<ArgoServiceParams>): ServiceVersion {
  const { image } = service.type.params;
  const imagePullPolicy = service.type.params.image_pull_policy || env.defaultImagePullPolicy;
  const tagSeparatorIndex = image.lastIndexOf(':');
  const imageName = sanitizeImage(image.substring(0, tagSeparatorIndex));
  const imageTag = image.substring(tagSeparatorIndex + 1, image.length);
  return {
    name: service.name,
    image: imageName,
    tag: imageTag,
    image_pull_policy: imagePullPolicy,
  };
}

/**
 * Express.js handler that returns the Harmony versions being used for all services
 *
 * Displays JSON with a list of all of the harmony services showing the service name,
 * the name of the image being used, and the tag.
 * @param req The request sent by the client
 * @param res The response to send to the client
 * @returns {void}
 */
export default function getVersions(req: HarmonyRequest, res: Response): void {
  const argoServices = getServiceConfigs()
    .filter((s) => s.type.name === 'argo')
    .map(getServiceForDisplay);
  res.json(argoServices);
}
