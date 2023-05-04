import { Logger } from 'winston';
import { batchProcessQueue } from '../backends/workflow-orchestration/work-item-updates';
import env from '../util/env';
import { Worker } from './worker';
import sleep from '../util/sleep';
import { WorkItemUpdateQueueType } from '../util/queue/queue';

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
    while (this.isRunning) {
      this.logger.info('Starting work item update queue processor');
      try {
        await batchProcessQueue(this.queueType);
      } catch (e) {
        this.logger.error('Work item update queue processor failed to process work item update queue');
        this.logger.error(e);
        // Wait for a bit before trying again to avoid a tight loop
        await sleep(env.workItemUpdateQueueProcessorDelayAfterErrorSec * 1000);
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }
}