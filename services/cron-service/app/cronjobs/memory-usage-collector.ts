/* eslint-disable @typescript-eslint/naming-convention */
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as k8s from '@kubernetes/client-node';

import { Context } from '../util/context';
import env from '../util/env';
import { CronJob } from './cronjob';

const NAMESPACE = 'harmony';
const METRIC_NAME = 'pod_memory_utilization';
const METRIC_NAMESPACE = 'ContainerInsights';
// The cloudwatch insights observability plugin seems to have a period of 5 minutes
const METRIC_PERIOD = 300;


/**
 * Gets the list of services.
 * @param ctx - The Cron job contex
 * @param kc - The k8s configuration
 * @throws error if there is an issue communicating with the Kubernetes API
 * @returns A promise that resolves to the list of backend services
 */
async function getListOfBackendServices(ctx: Context, kc: k8s.KubeConfig): Promise<string[]> {
  const { logger } = ctx;
  const hpaApi = kc.makeApiClient(k8s.AutoscalingV2Api);
  const hpaList = (await hpaApi.listNamespacedHorizontalPodAutoscaler({ namespace: NAMESPACE })).items;

  if (!hpaList || hpaList.length === 0) {
    throw new Error('No HPAs found, skipping gathering memory usage');
  }

  const services = hpaList
    .map(hpa => hpa.metadata?.name)
    .filter((name): name is string => Boolean(name));

  logger.info(`Found HPA services: ${services.join(', ')}`);
  return services;
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
 * @param ctx - The Cron job context
 * @param kc - The k8s configuration
 * @param serviceName - The name of the service
 * @param numMinutes - The number of minutes in the past to pull the memory usage from
 *        e.g. 60 means get metrics for the past 60 minutes to now.
 * @throws error if there is an issue communicating with the Kubernetes API
 * @returns A promise that resolves to the list of backend services
 */
async function getMemoryUsageByService(ctx: Context, kc: k8s.KubeConfig, serviceName: string, numMinutes: number): Promise<ServiceMemoryUsage> {
  const { logger } = ctx;

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - numMinutes * 60 * 1000);

  const cw = new CloudWatchClient({ region: process.env.AWS_DEFAULT_REGION });

  const cmd = new GetMetricStatisticsCommand({
    Namespace: METRIC_NAMESPACE,
    MetricName: METRIC_NAME,
    Dimensions: [
      { Name: 'ClusterName', Value: `harmony-${env.harmonyEnvironment}-cluster` },
      { Name: 'Namespace', Value: NAMESPACE },
      { Name: 'PodName', Value: serviceName },
    ],
    Statistics: ['Average', 'Maximum'],
    StartTime: startTime,
    EndTime: endTime,
    Period: METRIC_PERIOD,
  });

  const resp = await cw.send(cmd);
  const datapoints = resp.Datapoints ?? [];

  let avgPercent = 0;
  let maxPercent = 0;

  if (datapoints.length > 0) {
    const sumAvg = datapoints.reduce((acc, dp) => acc + (dp.Average ?? 0), 0);
    avgPercent = sumAvg / datapoints.length;
    maxPercent = datapoints.reduce((m, dp) => Math.max(m, dp.Maximum ?? 0), 0);
  } else {
    logger.warn(`No datapoints returned for service ${serviceName}`);
  }

  logger.debug(`CloudWatch for ${serviceName}: avg=${avgPercent} max=${maxPercent}`);

  const appsApi = kc.makeApiClient(k8s.AppsV1Api);

  const deployment: k8s.V1Deployment = await appsApi.readNamespacedDeployment({
    name: serviceName,
    namespace: NAMESPACE,
  });

  const containers = deployment.spec?.template?.spec?.containers ?? [];

  // Extract memory limits strings (e.g. "512Mi", "1Gi")
  const memoryLimitStrs: string[] = containers
    .map(c => c.resources?.limits?.memory)
    .filter((m): m is string => Boolean(m));

  // Convert memory limits to bytes
  let totalLimitBytes = 0;
  for (const mem of memoryLimitStrs) {
    let bytes = 0;
    const miMatch = mem.match(/^(\d+)(?:Mi)$/);
    const giMatch = mem.match(/^(\d+)(?:Gi)$/);
    const kiMatch = mem.match(/^(\d+)(?:Ki)$/);
    const plainNumMatch = mem.match(/^(\d+)$/);

    if (miMatch) {
      bytes = Number(miMatch[1]) * 1024 * 1024;
    } else if (giMatch) {
      bytes = Number(giMatch[1]) * 1024 * 1024 * 1024;
    } else if (kiMatch) {
      bytes = Number(kiMatch[1]) * 1024;
    } else if (plainNumMatch) {
      // treat as bytes if no unit present
      bytes = Number(plainNumMatch[1]);
    } else {
      logger.warn(`Unknown memory limit format "${mem}" for ${serviceName}, treating as 0`);
      bytes = 0;
    }

    logger.debug(`Parsed memory limit ${mem} => ${bytes} bytes for ${serviceName}`);
    totalLimitBytes += bytes;
  }

  const usageBytes = maxPercent * totalLimitBytes;
  const usageGB = usageBytes / 1024 / 1024 / 1024;

  return {
    service: serviceName,
    avgPercent,
    maxPercent,
    totalLimitBytes,
    usageGB: Number(usageGB.toFixed(2)),
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
async function saveMemoryUsageToS3(ctx: Context, memoryUsage: Record<string, ServiceMemoryUsage>): Promise<void> {
  const { logger } = ctx;
  const bucket = env.memoryUsageBucket;

  // Format timestamp as YYYY-MM-DD-HHMM (UTC)
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ts = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;

  const key = `memory-metrics/${env.harmonyEnvironment}/${ts}.json`;
  const payload = {};

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
 * Gets memory usage by service.
 * @param ctx - The Cron job context
 * @throws error if there is an issue communicating with the Kubernetes API
 * @returns Resolves when the request completes
 */
async function runMemoryUsageCollector(ctx: Context): Promise<void> {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const services = await getListOfBackendServices(ctx, kc);
  const memoryUsageByService: Record<string, ServiceMemoryUsage> = {};

  for (const service of services) {
    const memoryUsage = await getMemoryUsageByService(ctx, kc, service, env.memoryUsageCollectorLookBackMinutes);
    memoryUsageByService[service] = memoryUsage;
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
