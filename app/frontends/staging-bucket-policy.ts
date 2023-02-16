import aws from 'aws-sdk';
import { RequestValidationError } from '../util/errors';

const policyTemplate = {
  'Version': '2012-10-17',
  'Statement': [
    {
      'Sid': 'write permission',
      'Effect': 'Allow',
      'Principal': {
        'AWS': '',
      },
      'Action': 's3:PutObject',
      'Resource': '',
    },
    {
      'Sid': 'get bucket location permissions',
      'Effect': 'Allow',
      'Principal': {
        'AWS': '',
      },
      'Action': 's3:GetBucketLocation',
      'Resource': '',
    },
  ],
};

/**
 * Get the bucket name and key (path) from a bucket path, which may optionally be a full url
 * that includes the s3:// protocol prefix, a bucket name plus key/path, or just a bucket name
 *
 * @param bucketPath - the bucket plus optional path
 * @returns the bucket name and key (path). The key will be null if bucketPath is just a bucket
 * with no path. Any trailing / will be removed
 */
export function bucketKeyFromBucketPath(bucketPath: string): [string, string] {
  const regex = /^((s|S)3:\/\/)?([^\/]+)(\/?.*?)$/;
  const matches = bucketPath.match(regex);
  const bucket = matches[3];

  let key:string = null;
  if (matches.length > 3) {
    key = matches[4];
  }

  if (key?.includes('//')) {
    throw new RequestValidationError(`'${bucketPath}' is not a valid bucket name with optional path`);
  }

  // strip off trailing /
  if (key.endsWith('/')) {
    key = key.slice(0, -1);
  }

  return [bucket, key];
}

/**
 * Express.js handler that returns a bucket policy that will allow Harmony workers from this
 * deployment to stage data in the given bucket.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next middleware function in the stack
 */
export async function getStagingBucketPolicy(req, res): Promise<void> {
  let { bucketPath } = req.params;

  // get the bucket/key and validate that the given parameter is of the right form
  const [bucket, key] = bucketKeyFromBucketPath(bucketPath);
  if (key) {
    bucketPath = `${bucket}${key}`;
  } else {
    bucketPath = bucket;
  }

  // get the IAM role for this EC2 instance so we can infer the role for the EKS nodes, which
  // is what the workers will use when interacting with the external bucket
  let identity: aws.STS.GetCallerIdentityResponse;
  try {
    const sts = new aws.STS();
    identity = await sts.getCallerIdentity().promise();

  } catch (e) {
    throw new RequestValidationError('Bucket policy generation is only available on AWS Harmony deployments');
  }

  const arn = identity.Arn;
  const regex = /arn:aws:iam::\d+:role\/harmony-(.+)-role/;
  const envName = arn.match(regex)[1];
  const eksRoleArn = arn.replace(envName, `${envName}-eks-node-group`);
  policyTemplate.Statement[0].Principal.AWS = eksRoleArn;
  policyTemplate.Statement[1].Principal.AWS = eksRoleArn;
  policyTemplate.Statement[0].Resource = `arn:aws:s3:::${bucketPath}/*`;
  policyTemplate.Statement[1].Resource = `arn:aws:s3:::${bucket}`;
  res.send(policyTemplate);

}