import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class Hackfest252Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the SQS queue
    const queue = new sqs.Queue(this, 'JnQueue', {
      queueName: 'jn-lambda-queue',
      // Optional: Set visibility timeout (should be at least 6x your lambda timeout)
      visibilityTimeout: cdk.Duration.seconds(60)
    });

    const dockerFunc = new lambda.DockerImageFunction(this, "DockerFunc", {
      code: lambda.DockerImageCode.fromImageAsset("./image"),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(10),
      architecture: lambda.Architecture.ARM_64,
    });

    // Add SQS as an event source for the Lambda function
    dockerFunc.addEventSource(new lambdaEventSources.SqsEventSource(queue, {
      batchSize: 1, // Process just one message at once
      // maxBatchingWindow: cdk.Duration.seconds(5), // Wait up to 5 seconds to collect messages
      // reportBatchItemFailures: true, // Enable partial batch failure reporting
    }));

    // Optional: Output the queue URL for reference
    new cdk.CfnOutput(this, 'QueueUrl', {
      value: queue.queueUrl,
      description: 'URL of the SQS queue'
    });
  }
}