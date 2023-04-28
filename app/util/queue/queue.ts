export interface ReceivedMessage {
  receipt: string;
  body: string;
}

export enum WorkItemUpdateQueueType {
  SMALL_ITEM_UPDATE = 'small-work-item-update',
  LARGE_ITEM_UPDATE = 'large-work-item-update',
  SYNCHRONOUS_ITEM_UPDATE = 'synchronous-work-item-update',
}

export abstract class Queue {
  abstract getMessage(): Promise<ReceivedMessage>;
  abstract getMessages(num: number): Promise<ReceivedMessage[]>;
  abstract sendMessage(msg: string): Promise<void>;
  abstract deleteMessage(receipt: string): Promise<void>;
  abstract deleteMessages(receipts: string[]): Promise<void>;
}