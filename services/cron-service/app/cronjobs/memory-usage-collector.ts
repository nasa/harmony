import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as k8s from '@kubernetes/client-node';
import axios from 'axios';

import { CronJob } from './cronjob';
import { Context } from '../util/context';
import env from '../util/env';

const NAMESPACE = 'harmony';
// cAdvisor metrics scraped by Prometheus (see config/prometheus.yaml)
const MAX_USAGE_METRIC = 'container_memory_max_usage_bytes';
const WORKING_SET_METRIC = 'container_memory_working_set_bytes';
// Resolution of the PromQL subqueries used to evaluate usage over the look back window
const QUERY_STEP = '1m';


/**
 * Gets the list of services.
 * @param ctx - The Cron job contex
 * @param kc - The k8s configuration
 * @throws error if there is an issue communicating with the Kubernetes API
 * @returns A promise that resolves to the list of backend services
 */

async function getListOfBackendServices(ctx: Context, kc: k8s.KubeConfig): Promise<{ serviceName: string, deploymentName: string }[]> {
  const { logger } = ctx;
  const hpaApi = kc.makeApiClient(k8s.AutoscalingV2Api);
  const hpaList = (await hpaApi.listNamespacedHorizontalPodAutoscaler({ namespace: NAMESPACE })).items;

  if (!hpaList || hpaList.length === 0) {
    throw new Error('No HPAs found, skipping gathering memory usage');
  }

  const services = hpaList
    .map(hpa => ({
      serviceName: hpa.metadata?.name,
      deploymentName: hpa.spec?.scaleTargetRef?.name,
    }))
    .filter((s): s is { serviceName: string, deploymentName: string } =>
      Boolean(s.serviceName) && Boolean(s.deploymentName));

  logger.info(`Found HPA services: ${services.map(s => s.serviceName).join(', ')}`);
  return services;
}


/**
 * Runs an instant PromQL query against the Prometheus server that scrapes cAdvisor.
 *
 * @param query - The PromQL query, which must evaluate to at most a single value
 * @throws error if there is an issue communicating with Prometheus or the query fails
 * @returns A promise that resolves to the value, or undefined if the query returned no data
 */
async function queryPrometheus(query: string): Promise<number | undefined> {
  const resp = await axios.get(`${env.memoryUsagePrometheusUrl}/api/v1/query`, {
    params: { query },
  });
  if (resp.data?.status !== 'success') {
    throw new Error(`Prometheus query failed: ${resp.data?.error ?? 'unknown error'}`);
  }
  const value = resp.data.data?.result?.[0]?.value?.[1];
  return value === undefined ? undefined : Number(value);
}

interface ServiceMemoryUsage {
  service: string;
  avgPercent: number;
  maxPercent: number;
  totalLimitBytes: number;
  usageGB: number;
}

/**
 * Gets memory usage by service.
 *
 * @param ctx - The Cron job context
 * @param kc - The k8s configuration
 * @param serviceName - The name of the service
 * @param numMinutes - The number of minutes in the past to pull the memory usage from
 *        e.g. 60 means get metrics for the past 60 minutes to now.
 * @throws error if there is an issue communicating with the Kubernetes API
 * @returns A promise that resolves to the list of backend services
 */
async function getMemoryUsageByService(
  ctx: Context,
  kc: k8s.KubeConfig,
  serviceName: string,
  deploymentName: string,
  numMinutes: number,
): Promise<ServiceMemoryUsage> {

  const { logger } = ctx;

  // Corrected selector: match pods by deploymentName, not serviceName
  const selector = `namespace="${NAMESPACE}",pod=~"^${deploymentName}-[a-z0-9]+-[a-z0-9]+$",container!=""`;

  const lookBack = `${numMinutes}m`;
  const maxQuery = `max(max_over_time(sum by (pod) (${MAX_USAGE_METRIC}{${selector}})[${lookBack}:${QUERY_STEP}]))`;
  const avgQuery = `avg(avg_over_time(sum by (pod) (${WORKING_SET_METRIC}{${selector}})[${lookBack}:${QUERY_STEP}]))`;

  const [maxResult, avgResult] = await Promise.all([
    queryPrometheus(maxQuery),
    queryPrometheus(avgQuery),
  ]);

  if (maxResult === undefined || avgResult === undefined) {
    logger.warn(`No datapoints returned for service ${serviceName} using deployment prefix ${deploymentName}`);
  }

  const maxBytes = maxResult ?? 0;
  const avgBytes = avgResult ?? 0;

  logger.debug(
    `Memory usage in MB for ${serviceName}: avg=${avgBytes / 1024 / 1024} max=${maxBytes / 1024 / 1024}`,
  );

  const appsApi = kc.makeApiClient(k8s.AppsV1Api);
  const deployment: k8s.V1Deployment = await appsApi.readNamespacedDeployment({
    name: deploymentName,
    namespace: NAMESPACE,
  });

  const containers = deployment.spec?.template?.spec?.containers ?? [];
  let totalLimitBytes = 0;

  for (const c of containers) {
    const mem = c.resources?.limits?.memory;
    if (!mem) {
      logger.debug(`Container ${c.name} has no memory limit in ${deploymentName}`);
      continue;
    }

    let bytes = 0;

    const miMatch = mem.match(/^(\d+)Mi$/);
    const giMatch = mem.match(/^(\d+)Gi$/);
    const kiMatch = mem.match(/^(\d+)Ki$/);
    const plainNumMatch = mem.match(/^(\d+)$/);

    if (miMatch) bytes = Number(miMatch[1]) * 1024 * 1024;
    else if (giMatch) bytes = Number(giMatch[1]) * 1024 * 1024 * 1024;
    else if (kiMatch) bytes = Number(kiMatch[1]) * 1024;
    else if (plainNumMatch) bytes = Number(plainNumMatch[1]);
    else {
      logger.warn(`Unknown memory limit "${mem}" in ${deploymentName}`);
      continue;
    }

    totalLimitBytes += bytes;
  }

  const avgPercent = totalLimitBytes ? (100 * avgBytes / totalLimitBytes) : 0;
  const maxPercent = totalLimitBytes ? (100 * maxBytes / totalLimitBytes) : 0;

  const maxUsageGB = maxBytes / 1024 / 1024 / 1024;

  return {
    service: serviceName,
    avgPercent,
    maxPercent,
    totalLimitBytes,
    usageGB: Number(maxUsageGB.toFixed(2)),
  };
}

/**
 * Saves the memory usage collected this run to S3. The memory notifier lambda function reads
 * the files in the S3 bucket to send out an email report. In order to work correctly the following
 * format for the metrics is required:
 *
 *  "Average Utilization (%)": avg_percent,
 *  "Maximum Utilization (%)": max_percent,
 *  "Maximum Usage (GB)": max_usage_gb
 *
 * The objects must be named according to this convention:
 *   timestamp = datetime.utcnow().strftime("%Y-%m-%d-%H%M")
 *   key = memory-metrics/$HARMONY_ENVIRONMENT/$timestamp.json"
 * @param ctx - The Cron job context
 * @param memoryUsage - The memory usage with each key being the service name and value the memory
 *        usage for that service
 */
async function saveMemoryUsageToS3(
  ctx: Context, memoryUsage: Record<string, ServiceMemoryUsage>,
): Promise<void> {
  const { logger } = ctx;
  const bucket = env.memoryUsageBucket;

  // Format timestamp as YYYY-MM-DD-HHMM (UTC)
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ts = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;

  const key = `memory-metrics/${env.harmonyEnvironment}/${ts}.json`;
  const payload: Record<string, Record<string, number>> = {};

  for (const [service, usage] of Object.entries(memoryUsage)) {
    payload[service] = {
      'Average Utilization (%)': usage.avgPercent,
      'Maximum Utilization (%)': usage.maxPercent,
      'Maximum Usage (GB)': usage.usageGB,
    };
  }

  const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION });

  const put = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(payload, null, 2),
    ContentType: 'application/json',
  });

  await s3.send(put);
  logger.info(`Saved memory usage JSON to s3://${bucket}/${key}`);
}

/**
 * Main function that gets called each time the cron kicks off. It collects the
 * memory usage metrics and then saves them to S3.
 *
 * @param ctx - The Cron job context
 * @throws error if there is an issue communicating with the Kubernetes API
 * @returns Resolves when the request completes
 */
async function runMemoryUsageCollector(ctx: Context): Promise<void> {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  // Now returns: [{ serviceName, deploymentName }]
  const services = await getListOfBackendServices(ctx, kc);

  const memoryUsageByService: Record<string, ServiceMemoryUsage> = {};

  for (const { serviceName, deploymentName } of services) {
    const memoryUsage = await getMemoryUsageByService(
      ctx,
      kc,
      serviceName,
      deploymentName,
      env.memoryUsageCollectorLookBackMinutes,
    );

    memoryUsageByService[serviceName] = memoryUsage;
  }

  await saveMemoryUsageToS3(ctx, memoryUsageByService);
}

/**
 * Memory Usage Collector class for cron service
 */
export class MemoryUsageCollector extends CronJob {
  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.info('Started memory usage collector cron job');
    try {
      await runMemoryUsageCollector(ctx);
    } catch (e) {
      logger.error('Failed to get memory usage statistics for harmony services');
      logger.error(e);
    }
  }
}
