import aws from 'aws-sdk';
import env from './env';

const { awsDefaultRegion, useLocalstack } = env;

export interface MessageQueue {
  /**
   * Delete a message from the queue
   *
   * @param queueUrl - The URL of the queue where the message was received
   * @param receipt - The receipt handle of the message to delete
   */
  deleteMessage: (queueUrl: string, receipt: string) => Promise<void>;

  /**
   * Receives the first message from the provided queue URL with the given
   * visibility timeout.  Promise resolves to null if no message is available
   *
   * @param queueUrl - The URL of the queue to receive a message from
   * @param visibilityTimeoutSeconds - The message's visibility timeout
   * @param waitTimeSeconds - The number of seconds to wait for a message before returning
   * @returns - An async iterator which produces queue messages
   */
  receiveMessage: (
    queueUrl: string,
    visibilityTimeoutSeconds: number,
    waitTimeSeconds: number,
  ) => Promise<QueueMessage>;

  /**
   * Puts the provided message on the queue with the given name
   *
   * @param queueUrl The URL of the queue to send the message on
   * @param message The message to send
   */
  sendMessage: (queueUrl: string, messageObj: string) => Promise<void>;
}

export interface QueueMessage {
  message: string;
  receipt: string;
}

/**
 * Class to use when interacting with AWS SQS
 */
export class SQSMessageQueue implements MessageQueue {
  private sqs: aws.SQS;

  /**
   * Builds an SQS-based message queue
   */
  constructor() {
    const endpointSettings: aws.SQS.ClientConfiguration = {};
    if (useLocalstack) {
      endpointSettings.endpoint = 'http://localhost:4566';
    }

    this.sqs = new aws.SQS({
      apiVersion: '2012-11-05',
      region: awsDefaultRegion,
      ...endpointSettings,
    });
  }

  /** {@inheritDoc MessageQueue.deleteMessage} */
  async deleteMessage(queueUrl: string, receipt: string): Promise<void> {
    await this.sqs.deleteMessage({
      QueueUrl: queueUrl,
      ReceiptHandle: receipt,
    }).promise();
  }

  /** {@inheritDoc MessageQueue.receiveMessage} */
  async receiveMessage(
    queueUrl: string,
    visibilityTimeoutSeconds: number,
    waitTimeSeconds = 10,
  ): Promise<QueueMessage> {
    const response = await this.sqs.receiveMessage({
      QueueUrl: queueUrl,
      VisibilityTimeout: visibilityTimeoutSeconds,
      WaitTimeSeconds: waitTimeSeconds,
      MaxNumberOfMessages: 1,
    }).promise();
    if (response.Messages) {
      return {
        message: response.Messages[0].Body,
        receipt: response.Messages[0].ReceiptHandle,
      };
    }
    return null;
  }

  /** {@inheritDoc MessageQueue.sendMessage} */
  async sendMessage(queueUrl: string, message: string): Promise<void> {
    await this.sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: message,
    }).promise();
  }
}

/**
 * Returns the default message queue for this instance of Harmony
 *
 * @returns {MessageQueue} the default message queue
 */
export function defaultMessageQueue(): MessageQueue {
  return new SQSMessageQueue();
}
