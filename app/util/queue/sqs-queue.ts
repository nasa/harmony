import { SQSClient, ReceiveMessageCommand, SendMessageCommand, DeleteMessageCommand, DeleteMessageBatchCommand, SQSClientConfig, SendMessageCommandInput, PurgeQueueCommand } from '@aws-sdk/client-sqs';
import env from '../env';
import { Queue, ReceivedMessage } from './queue';

export class SqsQueue extends Queue {
  queueUrl: string;

  sqs: SQSClient;

  constructor(queueUrl: string) {
    super();
    this.queueUrl = queueUrl;
    const sqsConfig: SQSClientConfig = {
      region: env.awsDefaultRegion,
    };
    if (env.useLocalstack) {
      sqsConfig.endpoint = 'http://localhost:4566';
    }
    this.sqs = new SQSClient(sqsConfig);
  }

  async getMessage(waitTimeSeconds = env.queueLongPollingWaitTimeSec): Promise<ReceivedMessage> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: waitTimeSeconds,
    });
    const response = await this.sqs.send(command);
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
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: num,
      WaitTimeSeconds: waitTimeSeconds,
    });
    const response = await this.sqs.send(command);
    if (response.Messages) {
      return response.Messages.map((message) => ({
        receipt: message.ReceiptHandle,
        body: JSON.parse(message.Body),
      }));
    }
    return [];
  }

  async sendMessage(msg: string, groupId?: string): Promise<void> {
    const message: SendMessageCommandInput = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(msg),
    };
    if (groupId) {
      message.MessageGroupId = groupId;
    }
    await this.sqs.send(new SendMessageCommand(message));
  }

  async deleteMessage(receipt: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receipt,
    });
    await this.sqs.send(command);
  }

  async deleteMessages(receipts: string[]): Promise<void> {
    const entries = receipts.map((receipt, index) => ({
      Id: index.toString(),
      ReceiptHandle: receipt,
    }));
    const command = new DeleteMessageBatchCommand({
      QueueUrl: this.queueUrl,
      Entries: entries,
    });
    await this.sqs.send(command);
  }

  async purge(): Promise<void> {
    await this.sqs.send(new PurgeQueueCommand({ QueueUrl: this.queueUrl }));
  }
}