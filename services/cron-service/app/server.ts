import { Cron } from 'croner';
import express from 'express';

import db from '../../harmony/app/util/db';
import log from '../../harmony/app/util/log';
import { Example } from './cronjobs/example';
import { WorkReaper } from './cronjobs/work-reaper';
import router from './routers/router';
import { Context } from './util/context';
import env from './util/env';

/**
 * Start the application
 */
export default function start(): void {

  // add cron entries here
  // see https://www.npmjs.com/package/croner#pattern for allowable crontab strings
  const cronEntries: [string, { run(ctx: Context): void; name: string; }][] = [
    ['*/10 * * * * *', Example], // every 10 seconds
    ['*/6 * * * *', WorkReaper], // every 6 minutes
  ];

  for (const [cronSpec, jobClass] of cronEntries) {
    // only run the example service if specifically asked to do so
    if (jobClass.name === 'Example' && !env.runExample) continue;

    const logger = log.child({ cronJob: jobClass.name });
    const ctx: Context = {
      logger,
      db,
    };
    new Cron(
      cronSpec, // when to run
      { // see https://www.npmjs.com/package/croner#options
        timezone: 'America/New_York',
        protect: true, // don't restart jobs that are still running
      },
      async function () {
        jobClass.run(ctx);
      }, // function run on cron tick
    );
  }


  // set up a express server for the health endpoint - used by k8s to monitor the pod
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
