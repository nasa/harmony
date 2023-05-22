import { RequestValidationError } from '../util/errors';
import SecureTokenService from '../util/sts';

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
      'Sid': 'get bucket location permission',
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
  if (!bucketPath) {
    throw new RequestValidationError('`bucketPath` is a required parameter that must consist of one of a bucket name, e.g., `my-bucket`, a bucket name plus path/key, e.g., `my-bucket/my/path`, or a full S3 url, e.g., `s3://my-bucket/my/path`.');
  }
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
  if (key?.endsWith('/')) {
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
  let { bucketPath } = req.query;

  // get the bucket/key and validate that the given parameter is of the right form
  const [bucket, key] = bucketKeyFromBucketPath(bucketPath);
  if (key) {
    bucketPath = `${bucket}${key}`;
  } else {
    bucketPath = bucket;
  }

  // get the IAM role for this EC2 instance so we can infer the role for the EKS nodes, which
  // is what the workers will use when interacting with the external bucket. This will fail
  // for local (non-AWS) Harmony
  try {
    const sts = new SecureTokenService();
    const identity = await sts.getCallerIdentity();
    const account = identity.Account;
    // for putObject
    policyTemplate.Statement[0].Principal.AWS = `arn:aws:iam::${account}:root`;
    policyTemplate.Statement[0].Resource = `arn:aws:s3:::${bucketPath}/*`;
    // for getBucketLocation
    policyTemplate.Statement[1].Principal.AWS = `arn:aws:iam::${account}:root`;
    policyTemplate.Statement[1].Resource = `arn:aws:s3:::${bucket}`;
    res.send(policyTemplate);
  } catch (e) {
    const { logger } = req.context;
    logger.error(e);
    throw new RequestValidationError('Failed to generate bucket policy. Bucket policy generation is only available on AWS Harmony deployments');
  }
}