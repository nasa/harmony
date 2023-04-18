import { Logger } from 'winston';
import { batchProcessQueue } from '../backends/workflow-orchestration';
import env from '../util/env';
import { Worker } from './worker';
import sleep from '../util/sleep';
import { WorkItemUpdateQueueType } from '../util/queue';

export interface WorkItemUpdateQueueProcessorConfig {
  logger: Logger;
  queueType: WorkItemUpdateQueueType;
}

export default class WorkItemUpdateQueueProcessor implements Worker {
  isRunning: boolean;

  logger: Logger;

  queueType: WorkItemUpdateQueueType;

  constructor(config: WorkItemUpdateQueueProcessorConfig) {
    this.logger = config.logger;
    this.queueType = config.queueType;
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
        await batchProcessQueue(this.queueType);
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