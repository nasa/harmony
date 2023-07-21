import express from 'express';
import env from './util/env';
import log, { default as defaultLogger } from '../../../app/util/log';
import router from './routers/router';
import { Server } from 'http';
import Updater from './workers/updater';
import { eventEmitter } from '../../../app/events';
import WorkItem, { WorkItemEvent } from '../../../app/models/work-item';
import { getWorkSchedulerQueue } from '../../../app/util/queue/queue-factory';

/**
 * Start the application
 * @returns An object containing the running components
 */
export default function start(): Server {

  // start the updater
  const updater = new Updater();
  updater.start().catch((e) => {
    log.error('Updater start failed');
    throw e;
  });

  const app = express();

  app.use(express.json());
  app.use('/', router());

  return app.listen(env.port, '0.0.0.0', () => {
    log.info(`Application listening on port ${env.port}`);
  });
}

// Listen for work items being created and put a message on the scheduler queue asking it to
// schedule some WorkItems for the service
eventEmitter.on(WorkItemEvent.CREATED, async (workItem: WorkItem) => {
  if (env.useServiceQueues) {
    const { serviceID } = workItem;
    defaultLogger.debug(`Work item created for service ${serviceID}, putting message on scheduler queue`);
    const queue = getWorkSchedulerQueue();
    await queue.sendMessage(serviceID);
  }
});

if (require.main === module) {
  start();
}

