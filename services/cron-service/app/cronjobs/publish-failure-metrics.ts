import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';

import { WorkItemStatus } from '../../../harmony/app/models/work-item-interface';
import { Context } from '../util/context';
import env from '../util/env';
import { serviceIDToCanonicalServiceName } from '../util/services';
import { CronJob } from './cronjob';

export interface MetricData {
  metricName: string;
  namespace: string;
  value: number;
  unit?: StandardUnit;
  dimensions?: { [key: string]: string; };
  timestamp?: Date;
}

interface FailedWorkItemPercentage {
  service: string;
  percent: number;
}

interface WorkItemsQueryResult {
  serviceID: string;
  status: string;
  count: string; // Knex returns count as string, we'll convert to number
}

export interface CloudWatchClientConfig {
  region: string;
  endpoint?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  }
}

/**
 * Get a CloudWatch client config for either localstack or a real environment.
 * @returns a configuration appropriate for the working environment
 */
export function getCloudWatchClientConfig(): CloudWatchClientConfig {
  let config: CloudWatchClientConfig;

  if (process.env.USE_LOCALSTACK === 'true') {
    const { localstackHost } = env;

    config = {
      region: env.awsDefaultRegion,
      endpoint: `http://${localstackHost}:4572`,
      credentials: {
        accessKeyId: 'localstack',
        secretAccessKey: 'localstack',
      },
    };
  } else {
    config = {
      region: env.awsDefaultRegion,
      // Credentials will be automatically loaded from environment, IAM role, or AWS config
    };
  }

  return config;
}

/**
 * Get the percentage of failed work-items for all services over the given timeframe
 *
 * @param ctx - The Cron job context
 * @param minutesBack - How many minutes back to look for metrics (default 60)
 * @returns
 */
export async function getFailedWorkItemPercentageByServiceWithTimeWindow(
  ctx: Context,
  minutesBack: number = 60,
): Promise<FailedWorkItemPercentage[]> {
  const { logger, db } = ctx;
  logger.info('Getting service status counts');
  try {
    const now = new Date();
    const timeAgo = new Date(now.getTime() - minutesBack * 60 * 1000);

    // const serviceCounts = new Map<string, number[]>();
    const serviceCounts = {};

    // get all the services - need to do this here as some of the services may not have recent
    // work-items, but we still want to report metrics for them
    const allServices = await db
      .from('work_items')
      .distinct('serviceID');

    // normalize service names by removing tags from service IDs
    for (const { serviceID } of allServices) {
      const service = await serviceIDToCanonicalServiceName(serviceID);
      serviceCounts[service] = [0, 0];
    }

    const queryResults = await db
      .from('work_items')
      .select('serviceID', 'status')
      .count('* as count')
      .whereIn('status', [WorkItemStatus.FAILED, WorkItemStatus.SUCCESSFUL, WorkItemStatus.WARNING])
      .where('updatedAt', '>=', timeAgo)
      .groupBy('serviceID', 'status')
      .orderBy(['serviceID', 'status']) as WorkItemsQueryResult[];

    // normalize service names by removing tags from service IDs and combine counts to normalized
    // service name
    for (const { serviceID, status, count } of queryResults) {
      // use the canonical name for the service
      const service = await serviceIDToCanonicalServiceName(serviceID);
      const numCount = parseInt(count, 10);
      logger.info(`Service ${service} ${status} count: ${numCount}`);

      if (status === WorkItemStatus.FAILED) {
        serviceCounts[service][0] += numCount;
      } else {
        serviceCounts[service][1] += numCount;
      }
    }

    const results = [];
    for (const service of Object.keys(serviceCounts)) {
      const values = serviceCounts[service];
      const failureCount = values[0];
      const totalCount = failureCount + values[1];
      let percent = 0;
      if (totalCount > 0) {
        percent = 100.0 * failureCount / totalCount;
      }
      results.push({
        service,
        percent,
      });
    }

    return results;

  } catch (error) {
    logger.error('Error querying for work-item failure statistics', error);
    throw error;
  }
}

/**
 * Publishes a single metric to CloudWatch
 */
export async function publishMetric(ctx: Context, client: CloudWatchClient, metricData: MetricData): Promise<void> {
  const { logger } = ctx;
  const { metricName, namespace, value, unit = 'Percent', dimensions, timestamp } = metricData;

  // Convert dimensions object to CloudWatch format
  const dimensionsArray = dimensions
    ? Object.entries(dimensions).map(([name, val]) => ({
      Name: name,
      Value: val,
    }))
    : undefined;

  const params = {
    Namespace: namespace,
    MetricData: [
      {
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: timestamp || new Date(),
        Dimensions: dimensionsArray,
      },
    ],
  };

  try {
    const command = new PutMetricDataCommand(params);
    await client.send(command);
  } catch (error) {
    logger.error('Error publishing failure metric:', error);
    throw error;
  }
}

/**
 * Publish service failure metrics to CloudWatch
 */
export class PublishServiceFailureMetrics extends CronJob {
  static async run(ctx: Context): Promise<void> {
    const { logger } = ctx;
    logger.info('Failure metrics publisher started.');

    try {
      const serviceFailurePercentages = await module.exports.getFailedWorkItemPercentageByServiceWithTimeWindow(ctx, env.failureMetricsLookBackMinutes);
      const namespace = `harmony-services-${env.clientId}`;
      logger.info(`Publishing ${serviceFailurePercentages.length} metrics to namespace ${namespace}`);

      // Initialize the CloudWatch client
      const config = module.exports.getCloudWatchClientConfig();
      const client = new CloudWatchClient(config);

      for (const serviceFailure of serviceFailurePercentages) {
        const data: MetricData = {
          metricName: 'harmony-service-percent-failures',
          namespace: namespace,
          value: serviceFailure.percent,
          dimensions: {
            'service': serviceFailure.service,
          },
          timestamp: new Date(),
        };

        await module.exports.publishMetric(ctx, client, data);
      }

      logger.info('Failure metrics publication completed.');
    } catch (error) {
      logger.error('Failed to compute and publish all service failure metrics');
      logger.error(error);
    }
  }
}