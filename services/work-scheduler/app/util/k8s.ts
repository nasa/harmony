import logger from '../../../harmony/app/util/log';
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

  const runningPods = pods.filter((pod) => pod.status.phase === 'Running');
  return runningPods.length;
}

/**
 * Get the number of pods running for a given pod name
 * @param podName - The pod name for which to get the number of pods
 * @param namespace - The namespace in which to look for pods
 * @returns The number of pods running for the service
 **/
export async function getPodsCountForPodName(podName: string, namespace = 'harmony'): Promise<number> {
  try {
    const labelSelector = `name=${podName}`;

    const res = await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSelector);
    const pods = res.body.items;
    const runningPods = pods.filter(pod => pod.status.phase === 'Running');

    return runningPods.length;
  } catch (e) {
    logger.error(`Error getting the number of running ${podName} pods`);
    logger.error(e);
    return 1;
  }
}
