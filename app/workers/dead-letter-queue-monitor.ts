import { Logger } from 'winston';
import { defaultMessageQueue, MessageQueue } from '../util/message-queue';
import log from '../util/log';
import db from '../util/db';
import { Job } from '../models/job';

/**
 * Dead letter queue monitor.  Watches a dead letter queue for incoming messages,
 * ensuring as much as possible that it can remain running and allowing graceful
 * shutdown.
 *
 * Messages received in the queue are logged, their jobs marked failed where possible,
 * and then removed from the queue.
 */
export default class DeadLetterQueueMonitor {
  queueUrl: string;

  queue: MessageQueue;

  logger: Logger;

  running: Promise<void>;

  shouldRun: boolean;

  /**
   * Creates an instance of dead letter queue monitor.
   * @param queueUrl - The URL of the queue to monitor
   */
  constructor(queueUrl: string) {
    this.queueUrl = queueUrl;
    this.queue = defaultMessageQueue();
    this.logger = log.child({ app: 'worker.dlqmonitor', queue: this.queueUrl });
  }

  /**
   * Runs the queue monitor once, either receiving a message and processing it or
   * timing out after `receiveMessageTimeoutSeconds` elapses.
   *
   * @param receiveMessageTimeoutSeconds - The number of seconds to wait for a new message
   * @returns - Resolves a single message has been fully processed or a timeout happens
   */
  private async runOnce(receiveMessageTimeoutSeconds): Promise<void> {
    const { queueUrl, logger, queue } = this;
    const response = await queue.receiveMessage(queueUrl, 60, receiveMessageTimeoutSeconds);
    if (!response) {
      logger.debug(`No items to process in dead letter queue ${this.queueUrl}`);
      return;
    }
    const { message, receipt } = response;
    let obj;
    try {
      obj = JSON.parse(message);
    } catch (e) {
      logger.error(`Could not parse message as JSON (${e}): ${message}`);
      await queue.deleteMessage(queueUrl, receipt);
      return;
    }
    if (!obj.requestId) {
      logger.error(`Invalid queue message, no requestId: ${message}`);
    } else {
      const trx = await db.transaction();
      const job = await Job.byRequestId(trx, obj.requestId);
      if (!job) {
        logger.error(`Could not find a job entry to fail request ${obj.requestId}`, { request: obj });
      } else {
        job.fail('Service request failed with an unknown error.');
        await job.save(trx);
      }
      trx.commit();
    }
    await queue.deleteMessage(queueUrl, receipt);
  }

  /**
   * Starts monitoring the queue.  A low receive timeout will cause increased resource usage
   * and demands in the node process.  A high timeout will cause graceful shutdowns via server.stop
   * to take longer.  The value should generally be large in development and deployed environments
   * but low in test to allow faster cycling.
   *
   * Important: awaiting this method is not generally a good idea, since it will only resolve once
   *   the service is explicitly stopped, which is likely never in non-test environments
   *
   * @param [receiveMessageTimeoutSeconds] - The number of seconds to wait for a new message
   * @returns - Resolves when `#stop()` is called and any in-flight processing completes
   */
  async start(receiveMessageTimeoutSeconds = 10): Promise<void> {
    this.shouldRun = true;
    let resolve;
    this.running = new Promise((resolveFn) => { resolve = resolveFn; });
    this.logger.info('starting queue');
    while (this.shouldRun) {
      try {
        await this.runOnce(receiveMessageTimeoutSeconds);
      } catch (e) {
        this.logger.error(`Error handling dead job: ${e.message} ${e.stack}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    this.running = null;
    resolve();
  }

  /**
   * Stops the monitor
   * @returns - Resolves when the monitor has cleanly stopped
   */
  async stop(): Promise<void> {
    this.shouldRun = false;
    await this.running;
  }
}
