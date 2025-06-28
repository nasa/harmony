import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: '../../harmony-ci-cd/.env' });

// Get the queue ARN from environment variable
const queueArn = process.env.SQS_QUEUE_ARN;

if (!queueArn) {
  throw new Error('SQS_QUEUE_ARN environment variable must be set');
}

if (!process.env.SHARED_SECRET_KEY) {
  throw new Error('NO SHARED_SECRET_KEY');
}

export class Hackfest252Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
        region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-west-2',
      },
    });

    // Import the existing SQS queue
    const queue = sqs.Queue.fromQueueArn(this, 'ImportedQueue', queueArn as string);

    // Create the SQS queue
    // const queue = new sqs.Queue(this, 'JnQueue', {
    //   queueName: 'jn-lambda-queue',
    // Optional: Set visibility timeout (should be at least 6x your lambda timeout)
    //   visibilityTimeout: cdk.Duration.seconds(60),
    // });

    const vpcId = process.env.VPC_ID;
    let vpc: ec2.IVpc;

    vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
      vpcId: vpcId
    });

    const subnetIds = process.env.SUBNET_IDS?.split(',') || [];

    if (subnetIds.length === 0) {
      throw new Error('SUBNET_IDS environment variable must be set with comma-separated subnet IDs');
    }

    const vpcSubnets: ec2.SubnetSelection = {
      subnets: subnetIds.map((subnetId, index) =>
        ec2.Subnet.fromSubnetId(this, `ImportedSubnet${index}`, subnetId.trim())
      )
    };

    const securityGroupIds = process.env.SECURITY_GROUP_IDS?.split(',') || [];

    if (securityGroupIds.length === 0) {
      throw new Error('SECURITY_GROUP_IDS environment variable must be set with comma-separated security group IDs');
    }

    const securityGroups = securityGroupIds.map((sgId, index) =>
      ec2.SecurityGroup.fromSecurityGroupId(this, `ImportedSecurityGroup${index}`, sgId.trim())
    );

    const dockerFunc = new lambda.DockerImageFunction(this, 'DockerFunc', {
      code: lambda.DockerImageCode.fromImageAsset('./image'),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      architecture: lambda.Architecture.ARM_64,
      environment: {
        ENV: process.env.ENV || 'dev',
        CALLBACK_URL_ROOT: process.env.CALLBACK_URL_ROOT || '',
        STAGING_BUCKET: process.env.STAGING_BUCKET || '',
        STAGING_PATH: process.env.STAGING_PATH || '',
        ARTIFACT_BUCKET: process.env.ARTIFACT_BUCKET || '',
        OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI || '',
        OAUTH_PASSWORD: process.env.OAUTH_PASSWORD || '',
        OAUTH_UID: process.env.OAUTH_UID || '',
        OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID || '',
        SHARED_SECRET_KEY: process.env.SHARED_SECRET_KEY || '',
        // Add other environment variables as needed
        // ANOTHER_VAR: process.env.ANOTHER_VAR || 'default-value',
      },
      vpc: vpc,
      vpcSubnets: vpcSubnets,
      securityGroups: securityGroups,
    });

    // Add SQS as an event source for the Lambda function
    dockerFunc.addEventSource(new lambdaEventSources.SqsEventSource(queue, {
      batchSize: 1, // Process just one message at once
      // maxBatchingWindow: cdk.Duration.seconds(5), // Wait up to 5 seconds to collect messages
      // reportBatchItemFailures: true, // Enable partial batch failure reporting
    }));

    // Optional: Output the queue URL for reference
    // new cdk.CfnOutput(this, 'QueueUrl', {
    //   value: queue.queueUrl,
    //   description: 'URL of the SQS queue',
    // });

    dockerFunc.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        'arn:aws:s3:::*',
        'arn:aws:s3:::*/*',
      ],
    }));
  }
}