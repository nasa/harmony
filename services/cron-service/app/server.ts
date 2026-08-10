import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import * as duckdb from '@duckdb/node-api';
import { Cron } from 'croner';
import express from 'express';

import { CronJobClass } from './cronjobs/cronjob';
import { MemoryUsageCollector } from './cronjobs/memory-usage-collector';
import { PublishServiceFailureMetrics } from './cronjobs/publish-failure-metrics';
import { RestartPrometheus } from './cronjobs/restart-prometheus';
import {
  AnalyticsCron,
} from './cronjobs/update-analytics';
import { UserWorkUpdater } from './cronjobs/update-user-work';
import { WorkItemsStatsCron } from './cronjobs/update-work-items-stats';
import { WorkReaper } from './cronjobs/work-reaper';
import router from './routers/router';
import { Context } from './util/context';
import { initDbConnection, acquireDuckDbConnection } from './util/db/iceberg-connection';
import env from './util/env';
import db from '../../harmony/app/util/db';
import log from '../../harmony/app/util/log';


/**
 * Start the application
 */
export default async function start(): Promise<void> {

  // add cron entries here
  // see https://www.npmjs.com/package/croner#pattern for allowable crontab strings
  const cronEntries: [string, CronJobClass][] = [
    // [env.workReaperCron, WorkReaper],
    // [env.restartPrometheusCron, RestartPrometheus],
    // [env.userWorkUpdaterCron, UserWorkUpdater],
    // [env.publishServiceFailureMetricsCron, PublishServiceFailureMetrics],
    // [env.memoryUsageCollectorCron, MemoryUsageCollector],
    // [env.workItemsStatsCron, WorkItemsStatsCron],
    [env.analyticsCron, AnalyticsCron],
  ];

  // const duckDbConn = await acquireDuckDbConnection();
  const instance = await DuckDBInstance.fromCache(':memory:');
  const duckDbConn = await instance.connect();
  await initDbConnection(duckDbConn);

  for (const [cronSpec, jobClass] of cronEntries) {
    const logger = log.child({ 'cron_job': jobClass.name });
    const ctx: Context = {
      logger,
      db,
      duckDbConn,
    };
    new Cron(
      cronSpec, // when to run
      { // see https://www.npmjs.com/package/croner#options
        timezone: 'America/New_York',
        protect: true, // don't restart jobs that are still running
      },
      async () => {
        await jobClass.run(ctx);
      }, // function run on cron tick
    );
  }

  // set up an express server for the health endpoint - used by k8s to monitor the pod
  const app = express();

  app.use(express.json());
  app.use('/', router());

  app.listen(env.port, '0.0.0.0', () => {
    log.info(`Application listening on port ${env.port}`);
  });
}

if (require.main === module) {
  start();
}
