import logger from '../../../../app/util/log';
import { k8sApi } from '../workers/scheduler';

/**
 * Get the number of pods running for a service
 * @param serviceId - The service ID for which to get the number of pods
 * @param namespace - The namespace in which to look for pods
 * @returns The number of pods running for the service
 * @throws An error if the Kubernetes API call fails
 **/
export async function getPodsCountForService(serviceId: string, namespace = 'harmony'): Promise<number> {
  const startTime = Date.now();
  // Get all pods in the namespace
  const allPodsResponse = await k8sApi.listNamespacedPod(namespace);
  const endTime = Date.now();
  logger.debug(`getPodsCountForService: Got all pods in ${endTime - startTime}ms`);
  // Count the ones that have a container with the service ID as the image
  const pods = allPodsResponse.body.items.filter((pod) => {
    return pod.spec.containers.some((container) => {
      return container.image === serviceId;
    });
  });

  return pods.length;
}
