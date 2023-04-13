import { Logger } from 'winston';
import { processQueue } from '../backends/workflow-orchestration';
import env from '../util/env';
import { Worker } from './worker';
import sleep from '../util/sleep';

export interface WorkItemUpdateQueueProcessorConfig {
  logger: Logger;
}

export default class WorkItemUpdateQueueProcessor implements Worker {
  isRunning: boolean;

  logger: Logger;

  constructor(config: WorkItemUpdateQueueProcessorConfig) {
    this.logger = config.logger;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    let firstRun = true;
    while (this.isRunning) {
      if (!firstRun) {
        await sleep(env.workItemUpdateQueueProcessorPeriodSec * 1000);
      }
      this.logger.info('Starting work item update queue processor');
      try {
        await processQueue();
      } catch (e) {
        this.logger.error('Work item update queue processor failed to process work item update queue');
        this.logger.error(e);
      } finally {
        firstRun = false;
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }
}