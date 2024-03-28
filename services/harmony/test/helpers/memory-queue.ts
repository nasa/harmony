import { v4 as uuid } from 'uuid';
import { Queue, ReceivedMessage, WorkItemQueueType } from '@harmony/util/queue';
// TODO - this is a hack. we should move the batchProcessQueue function to a common package.
import { batchProcessQueue } from '../../../work-updater/app/workers/updater';

interface StoredMessage extends ReceivedMessage {
  body: string;
  receipt: string;
  isVisible: boolean;
}


/**
 * This class is used to mock the SQS queue for testing purposes. It stores messages in memory.
 */
export class MemoryQueue extends Queue {
  messages: StoredMessage[];

  queueType: WorkItemQueueType;

  constructor(type: WorkItemQueueType = null) {
    super();
    this.messages = [];
    this.queueType = type;
  }

  async getMessage(_waitTimeSeconds: number): Promise<ReceivedMessage> {
    const message = this.messages.find((m) => m.isVisible);
    if (message) {
      message.isVisible = false;
      message.receipt = uuid();
    }
    return message;
  }

  async getMessages(num: number, _waitTimeSeconds: number): Promise<ReceivedMessage[]> {
    let messages;
    if (num === -1) { // Return all the messages
      messages = this.messages.filter((m) => m.isVisible);
    } else {
      messages = this.messages.filter((m) => m.isVisible).slice(0, num);
      if (messages.length > 0) {
        messages.forEach((m) => {
          m.isVisible = false;
          m.receipt = uuid();
        });
      }
    }
    return messages;
  }

  async getApproximateNumberOfMessages(): Promise<number> {
    return this.messages.filter((m) => m.isVisible).length;
  }

  // we don't care about groupId for testing purposes
  async sendMessage(msg: string, _groupId?: string, shouldProcessQueue = true): Promise<void> {
    this.messages.push({ receipt: '', body: msg, isVisible: true });
    if (shouldProcessQueue && [WorkItemQueueType.SMALL_ITEM_UPDATE, WorkItemQueueType.LARGE_ITEM_UPDATE]
      .includes(this.queueType)) {
      await batchProcessQueue(this.queueType);
    }
  }

  async deleteMessage(receipt: string): Promise<void> {
    this.messages = this.messages.filter((message) => message.receipt !== receipt);
  }

  async deleteMessages(receipts: string[]): Promise<void> {
    this.messages = this.messages.filter((message) => !receipts.includes(message.receipt));
  }

  async purge(): Promise<void> {
    this.messages = [];
  }
}
