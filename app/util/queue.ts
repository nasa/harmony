
export interface ReceivedMessage {
  receipt: string;
  body: string;
}


export abstract class Queue {
  abstract getMessage(): Promise<ReceivedMessage>;
  abstract getMessages(num: number): Promise<ReceivedMessage[]>;
  abstract sendMessage(msg: string): Promise<void>;
  abstract deleteMessage(receipt: string): Promise<void>;
  abstract deleteMessages(receipts: string[]): Promise<void>;
}