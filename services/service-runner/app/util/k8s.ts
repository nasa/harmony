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
  const workerContainer = pod.body.status?.containerStatuses?.find(
    (status) => status.name === containerName,
  );

  log.info(`Worker container: ${JSON.stringify(workerContainer)}`);

  return workerContainer?.state?.running !== undefined;
}
