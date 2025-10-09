import {
  DeleteMessageBatchCommand, DeleteMessageCommand, GetQueueAttributesCommand, PurgeQueueCommand,
  ReceiveMessageCommand, SendMessageCommand, SendMessageCommandInput, SQSClient, SQSClientConfig,
} from '@aws-sdk/client-sqs';

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
      sqsConfig.endpoint = `http://${env.localstackHost}:4566`;
      sqsConfig.credentials = {
        accessKeyId: 'LOCALSTACK',
        secretAccessKey: 'LOCALSTACK',
      };
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
    if (response.Messages?.length > 0) {
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

  async getApproximateNumberOfMessages(): Promise<number> {
    const command = new GetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages'],
    });

    const response = await this.sqs.send(command);
    return parseInt(response.Attributes.ApproximateNumberOfMessages, 10);
  }

  async sendMessage(msg: string, groupId?: string): Promise<void> {
    const message: SendMessageCommandInput = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(msg),
    };
    if (groupId) {
      message.MessageGroupId = groupId;
    }
    message.DelaySeconds = 0;
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
    // SQS only allows deleting up to 10 at a time so we need to batch the deletes
    const MAX_BATCH_SIZE = 10;
    const promises = [];

    for (let i = 0; i < receipts.length; i += MAX_BATCH_SIZE) {
      const batch = receipts.slice(i, i + MAX_BATCH_SIZE);
      const entries = batch.map((receipt, index) => ({
        Id: index.toString(),
        ReceiptHandle: receipt,
      }));

      promises.push(
        this.sqs.send(
          new DeleteMessageBatchCommand({
            QueueUrl: this.queueUrl,
            Entries: entries,
          }),
        ),
      );
    }

    await Promise.all(promises);
  }


  async purge(): Promise<void> {
    await this.sqs.send(new PurgeQueueCommand({ QueueUrl: this.queueUrl }));
  }
}