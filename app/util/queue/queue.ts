export interface ReceivedMessage {
  receipt: string;
  body: string;
}

export enum WorkItemUpdateQueueType {
  SMALL_ITEM_UPDATE = 'small-work-item-update',
  LARGE_ITEM_UPDATE = 'large-work-item-update',
}

export abstract class Queue {
  abstract getMessage(waitTimeSeconds?: number): Promise<ReceivedMessage>;
  abstract getMessages(num: number, waitTimeSeconds?: number): Promise<ReceivedMessage[]>;
  abstract sendMessage(msg: string): Promise<void>;
  abstract deleteMessage(receipt: string): Promise<void>;
  abstract deleteMessages(receipts: string[]): Promise<void>;
}