
export interface ReceivedMessage {
  receipt: string;
  body: string;
}


export abstract class Queue {
  abstract getMessage(): Promise<ReceivedMessage>;
  abstract sendMessage(msg: string): Promise<void>;
  abstract deleteMessage(recept: string): Promise<void>;
}