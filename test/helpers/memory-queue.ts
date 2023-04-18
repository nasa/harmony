import { Queue, ReceivedMessage } from '../../app/util/queue';
import { v4 as uuid } from 'uuid';

export class MemoryQueue extends Queue {
  messages: ReceivedMessage[];

  constructor() {
    super();
    this.messages = [];
  }

  async getMessage(): Promise<ReceivedMessage> {
    return this.messages.shift();
  }

  async getMessages(num: number): Promise<ReceivedMessage[]> {
    return this.messages.splice(0, num);
  }

  async sendMessage(msg: string): Promise<void> {
    this.messages.push({ receipt: uuid(), body: msg });
  }

  async deleteMessage(receipt: string): Promise<void> {
    this.messages = this.messages.filter((message) => message.receipt !== receipt);
  }

  async deleteMessages(receipts: string[]): Promise<void> {
    this.messages = this.messages.filter((message) => !receipts.includes(message.receipt));
  }
}