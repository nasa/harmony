import { sanitizeImage } from '@harmony/util/string';

import env from './env';

/**
 * Convert image string into a normalized "base name"
 * - strips registry (ghcr.io, ECR, etc.)
 * - strips tag
 */
function getBaseImageName(image: string): string {
  const noTag = image.split(':')[0];
  return sanitizeImage(noTag);
}

/**
 * Convert ENV var name to service name
 * e.g. PODAAC_L2_SUBSETTER_IMAGE to podaac-l2-subsetter
 */
function envVarToServiceName(envVar: string): string {
  return envVar
    .replace(/_IMAGE$/, '')
    .toLowerCase()
    .replaceAll('_', '-');
}

/**
 * Create a map of the base Docker image name to the name of the service
 * for all services deployed to the environment
*/
export function _getImageToServiceMap(
  environment: NodeJS.ProcessEnv,
  services: Set<string>,
): Record<string, string> {
  return Object.keys(environment)
    .filter(k => k.endsWith('_IMAGE') && environment[k])
    .reduce((acc, key) => {
      const serviceName = envVarToServiceName(key);

      // only include deployed services
      if (!services.has(serviceName)) {
        return acc;
      }

      const base = getBaseImageName(environment[key]!);
      acc[base] = serviceName;

      return acc;
    }, {} as { [key: string]: string });
}

/**
 * Given a full image string, return the service name.
 * Falls back to repo path if no match is found.
 */
export function getServiceName(serviceMap, image: string): string {
  const base = getBaseImageName(image);
  return serviceMap[base] || base;
}

// Build up the list of all possible service names once at system start
const deployedServices = new Set(
  env.locallyDeployedServices.split(',').map(s => s.trim()),
);

deployedServices.add('query-cmr');

let _imageToServiceMap: Record<string, string> | undefined;

/**
 * As a singleton return the map of the base Docker image name to the name of the service
 * for all services deployed to the environment
 */
export function getImageToServiceMap(): Record<string, string> {
  if (_imageToServiceMap) {
    return _imageToServiceMap;
  }

  _imageToServiceMap = _getImageToServiceMap(process.env, deployedServices);
  return _imageToServiceMap;
}
