import { Logger } from 'winston';
import BaseService from './base-service';
import InvocationResult from './invocation-result';
import { defaultMessageQueue } from '../../util/message-queue';

interface MessageQueueServiceParams {
  queue_url: string;
}

/**
 * Service type that sends messages to a queue
 */
export default class MessageQueueService extends BaseService<MessageQueueServiceParams> {
  /**
   * Put the data operation on the message queue
   *
   * @param _logger the logger associated with the request
   * @returns - A promise resolving to null
   */
  async _run(_logger: Logger): Promise<InvocationResult> {
    const queue = defaultMessageQueue();
    const message = this.operation.serialize(this.config.data_operation_version);
    await queue.sendMessage(this.params.queue_url, message);
    return null;
  }
}
