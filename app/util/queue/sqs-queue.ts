import AWS from 'aws-sdk';
import env from '../env';
import { Queue, ReceivedMessage } from './queue';

export class SqsQueue extends Queue {
  queueUrl: string;

  sqs: AWS.SQS;

  constructor(
    queueUrl: string,
  ) {
    super();
    this.queueUrl = queueUrl;
    if (env.useLocalstack) {
      this.sqs = new AWS.SQS({
        endpoint: 'http://localhost:4566',
        region: env.awsDefaultRegion,
      });
    } else {
      this.sqs = new AWS.SQS({
        region: env.awsDefaultRegion,
      });
    }
  }

  async getMessage(waitTimeSeconds = env.queueLongPollingWaitTimeSec): Promise<ReceivedMessage> {
    const response = await this.sqs.receiveMessage({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: waitTimeSeconds,
    }).promise();
    if (response.Messages) {
      const message = response.Messages[0];
      return {
        receipt: message.ReceiptHandle,
        body: JSON.parse(message.Body),
      };
    }
    return null;
  }

  async getMessages(num: number, waitTimeSeconds = env.queueLongPollingWaitTimeSec): Promise<ReceivedMessage[]> {
    const response = await this.sqs.receiveMessage({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: num,
      WaitTimeSeconds: waitTimeSeconds,
    }).promise();
    if (response.Messages) {
      return response.Messages.map((message) => ({
        receipt: message.ReceiptHandle,
        body: JSON.parse(message.Body),
      }));
    }
    return [];
  }

  async sendMessage(msg: string): Promise<void> {
    await this.sqs.sendMessage({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(msg),
    }).promise();
  }

  async deleteMessage(receipt: string): Promise<void> {
    await this.sqs.deleteMessage({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receipt,
    }).promise();
  }

  async deleteMessages(receipts: string[]): Promise<void> {
    await this.sqs.deleteMessageBatch({
      QueueUrl: this.queueUrl,
      Entries: receipts.map((receipt, index) => ({
        Id: index.toString(),
        ReceiptHandle: receipt,
      })),
    }).promise();
  }
}