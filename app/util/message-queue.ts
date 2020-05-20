import aws from 'aws-sdk';
import env from './env';

const { awsDefaultRegion, useLocalstack } = env;

export interface MessageQueue {
  sendMessage: (queueUrl: string, messageObj: string) => Promise<void>;
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
      endpointSettings.endpoint = 'http://localhost:4576';
    }

    this.sqs = new aws.SQS({
      apiVersion: '2012-11-05',
      region: awsDefaultRegion,
      ...endpointSettings,
    });
  }

  /**
   * Puts the provided message on the queue with the given name
   *
   * @param queueUrl The URL of the queue to send the message on
   * @param message The message to send
   */
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
