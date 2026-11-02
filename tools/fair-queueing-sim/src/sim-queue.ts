import { Queue, ReceivedMessage } from '../../../services/harmony/app/util/queue/queue';

interface StoredMessage {
  body: string;
  receipt: string;
  visible: boolean;
}

/**
 * An in-memory stand-in for an SQS queue. Receives never block - waiting for a message (SQS long
 * polling) is modeled by the simulation actors, which register a listener to be told when a
 * message arrives. Received messages stay invisible until deleted; visibility timeouts are not
 * modeled since simulated components never crash.
 */
export class SimQueue extends Queue {
  readonly name: string;

  private messages: StoredMessage[] = [];

  private nextReceipt = 1;

  private listeners: (() => void)[] = [];

  /**
   * Creates a queue.
   *
   * @param name - a name for the queue, used in logging
   */
  constructor(name: string) {
    super();
    this.name = name;
  }

  /**
   * Registers a function to call every time a message is sent to the queue.
   *
   * @param listener - the function to call
   */
  onSend(listener: () => void): void {
    this.listeners.push(listener);
  }

  /**
   * Returns the number of messages that have not been received yet.
   *
   * @returns the number of visible messages
   */
  visibleCount(): number {
    return this.messages.reduce((count, m) => count + (m.visible ? 1 : 0), 0);
  }

  /**
   * Returns the bodies of the messages that have not been received yet.
   *
   * @returns the message bodies, oldest first
   */
  visibleBodies(): string[] {
    return this.messages.filter((m) => m.visible).map((m) => m.body);
  }

  private receive(num: number): ReceivedMessage[] {
    const received = [];
    for (const m of this.messages) {
      if (received.length >= num) break;
      if (m.visible) {
        m.visible = false;
        m.receipt = `r${this.nextReceipt++}`;
        received.push({ receipt: m.receipt, body: m.body });
      }
    }
    return received;
  }

  async getMessage(_waitTimeSeconds?: number): Promise<ReceivedMessage> {
    return this.receive(1)[0];
  }

  async getMessages(num: number, _waitTimeSeconds?: number): Promise<ReceivedMessage[]> {
    return this.receive(num);
  }

  async getApproximateNumberOfMessages(): Promise<number> {
    return this.visibleCount();
  }

  async sendMessage(msg: string, _groupId?: string): Promise<void> {
    this.messages.push({ body: msg, receipt: '', visible: true });
    for (const listener of this.listeners) {
      listener();
    }
  }

  async deleteMessage(receipt: string): Promise<void> {
    this.messages = this.messages.filter((m) => m.receipt !== receipt);
  }

  async deleteMessages(receipts: string[]): Promise<void> {
    const toDelete = new Set(receipts);
    this.messages = this.messages.filter((m) => !toDelete.has(m.receipt));
  }

  async purge(): Promise<void> {
    this.messages = [];
  }

  async changeMessageVisibility(_receipt: string, _visibilityTimeoutSeconds: number): Promise<void> {
    // visibility timeouts are not modeled
  }

  async changeMessageVisibilities(_receipts: string[], _visibilityTimeoutSeconds: number): Promise<void> {
    // visibility timeouts are not modeled
  }
}
