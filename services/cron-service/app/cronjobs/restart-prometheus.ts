import * as k8s from '@kubernetes/client-node';

import { Context } from '../util/context';
import { CronJob } from './cronjob';

/**
 * Checks if HPAs are functioning as expected and if not functioning kills
 * off the Prometheus pod so that the deployment starts a new one.
 * @param ctx - The Cron job context
 * @throws error if there is an issue communicating with the Kubernetes API
 * @returns Resolves when the request completes
 */
async function restartPrometheusIfBroken(ctx: Context): Promise<void> {
  const kc = new k8s.KubeConfig();
  const { logger } = ctx;
  kc.loadFromDefault();
  const hpaApi = kc.makeApiClient(k8s.AutoscalingV2Api);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);

  const hpaList = (await hpaApi.listNamespacedHorizontalPodAutoscaler({ namespace: 'harmony' })).items;

  if (!hpaList || hpaList.length === 0) {
    logger.warn('No HPAs found, skipping check to restart Prometheus');
    return;
  }

  // Checks to see if the metric used to scale the HPA is currently not known
  const hasUnknownTarget = hpaList.some(hpa => {
    const metrics = hpa.status?.currentMetrics;
    if (!metrics || metrics.length === 0) {
      return true;
    }
    const metricValue = metrics[0]?.object?.current?.averageValue;
    if (!metricValue) {
      return true;
    }
    return false;
  });

  if (!hasUnknownTarget) {
    logger.info(`All ${hpaList.length} HPAs are collecting metrics, Prometheus working as expected.`);
    return;
  }

  logger.warn('Detected HPA with unknown targets, restarting Prometheus pod.');

  const podList = await coreApi.listNamespacedPod({ namespace: 'monitoring' });
  const prometheusPod = podList.items.find(pod => pod.metadata?.name?.startsWith('prometheus'));

  if (!prometheusPod) {
    logger.warn('No Prometheus pod found in monitoring namespace.');
    return;
  }

  const podName = prometheusPod.metadata?.name;
  logger.info(`Deleting Prometheus pod: ${podName}`);

  await coreApi.deleteNamespacedPod({ name: podName!, namespace: 'monitoring' });
  logger.info('Prometheus pod deleted successfully.');
}

/**
 * Restart Prometheus class for cron service
 */
export class RestartPrometheus extends CronJob {
  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.info('Started restart Prometheus cron job');
    try {
      await restartPrometheusIfBroken(ctx);
    } catch (e) {
      logger.error('Failed to monitor and restart Prometheus');
      logger.error(e);
    }
  }
}
