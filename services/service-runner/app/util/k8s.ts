import * as k8s from '@kubernetes/client-node';

import log from '../../../harmony/app/util/log';
import env from './env';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

/**
 * Resolves to true if the worker container is running
 *
 * @param containerName - the name of the container to check e.g. worker or manager
 * @returns a promise resolving to true if the worker container is running and false otherwise
 */
export async function isContainerRunning(containerName: string): Promise<boolean> {
  const podName = env.myPodName;
  const namespace = 'harmony';

  const pod = await k8sApi.readNamespacedPod(podName, namespace);
  const container = pod.body.status?.containerStatuses?.find(
    (status) => status.name === containerName,
  );

  log.info(`Container: ${JSON.stringify(container)}`);

  return container?.state?.running !== undefined;
}

/**
 * Waits up to the timeout interval for the given container to be ready
 *
 * @param containerName - the name of the container to check e.g. worker or manager
 * @param timeout - how long to wait before giving up (ms)
 * @param checkInterval - how long to sleep (ms) between checks to see if the container is running
 * @returns a promise resolving to true if the worker container is running and false otherwise
 * @throws an error if the container does not start within the timeout period
 */
export async function waitForContainerToStart(
  containerName: string, timeout = 180_000, checkInterval = 3_000,
): Promise<boolean> {
  let running = false;

  const startTime = Date.now();

  log.info(`Waiting for the ${containerName} container to start up`);

  while (!running) {
    running = await isContainerRunning(containerName);
    if (running) {
      log.info(`${containerName} container is running.`);
      break;
    } else {
      log.info(`${containerName} container not yet running.`);
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeout) {
      log.error(`Timeout waiting for the ${containerName} container to be running.`);
      throw new Error(`${containerName} container did not start in time`);
    }

    log.warn(`${containerName} container not yet running, retrying in ${checkInterval / 1000} seconds`);
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  return running;
}
