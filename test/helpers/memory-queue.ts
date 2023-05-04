import { v4 as uuid } from 'uuid';
import { Queue, ReceivedMessage, WorkItemUpdateQueueType } from '../../app/util/queue/queue';
import { batchProcessQueue } from '../../app/backends/workflow-orchestration/workflow-orchestration';

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

  constructor() {
    super();
    this.messages = [];
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
    const messages = this.messages.filter((m) => m.isVisible).slice(0, num);
    if (messages.length > 0) {
      messages.forEach((m) => {
        m.isVisible = false;
        m.receipt = uuid();
      });
    }
    return messages;
  }

  async sendMessage(msg: string): Promise<void> {
    this.messages.push({ receipt: '', body: msg, isVisible: true });
    await batchProcessQueue(WorkItemUpdateQueueType.SMALL_ITEM_UPDATE);
  }

  async deleteMessage(receipt: string): Promise<void> {
    this.messages = this.messages.filter((message) => message.receipt !== receipt);
  }

  async deleteMessages(receipts: string[]): Promise<void> {
    this.messages = this.messages.filter((message) => !receipts.includes(message.receipt));
  }
}