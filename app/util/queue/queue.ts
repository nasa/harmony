export interface ReceivedMessage {
  receipt: string;
  body: string;
}

export enum WorkItemQueueType {
  SMALL_ITEM_UPDATE = 'small-work-item-update',
  LARGE_ITEM_UPDATE = 'large-work-item-update',
  SERVICE_QUEUE = 'service-queue',
  WORK_ITEM_SCHEDULER = 'work-item-scheduler',
}

export abstract class Queue {
  abstract getMessage(waitTimeSeconds?: number): Promise<ReceivedMessage>;
  abstract getMessages(num: number, waitTimeSeconds?: number): Promise<ReceivedMessage[]>;
  abstract getApproximateNumberOfMessages(): Promise<number>;
  abstract sendMessage(msg: string, groupId?: string): Promise<void>;
  abstract deleteMessage(receipt: string): Promise<void>;
  abstract deleteMessages(receipts: string[]): Promise<void>;
  abstract purge(): Promise<void>;
}