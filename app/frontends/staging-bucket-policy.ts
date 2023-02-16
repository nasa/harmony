import aws from 'aws-sdk';
import { RequestValidationError } from '../util/errors';

const policyTemplate = {
  'Version': '2012-10-17',
  'Statement': [
    {
      'Sid': 'Example permissions',
      'Effect': 'Allow',
      'Principal': {
        'AWS': '',
      },
      'Action': [
        's3:GetObject',
        's3:PutObject',
        's3:PutObjectAcl',
      ],
      'Resource': 'arn:aws:s3:::simple-bucket/*',
    },
  ],
};

/**
 *  Validate that the bucketPath is of the form `bucket_name/optional_path`
 * where the path may or may not end in '/'
 * @param bucketPath - the bucket name plus optional path
 */
function validateBucketPath(bucketPath: string): void {
  const regex = /^([^\/]+\/?)+$/;
  if (!regex.test(bucketPath)) {
    throw new RequestValidationError(`'${bucketPath}' is not a valid bucket name with optional path`);
  }
}

/**
 *
 * Express.js handler that returns a bucket policy that will allow Harmony workers from this
 * deployment to stage data in the given bucket.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next middleware function in the stack
 */
export async function getStagingBucketPolicy(req, res): Promise<void> {
  let { bucketPath } = req.params;
  // validate the bucket/path
  validateBucketPath(bucketPath);

  if (bucketPath.endsWith('/')) {
    bucketPath = bucketPath.slice(0, -1);
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
  policyTemplate.Statement[0].Resource = `arn:aws:s3:::${bucketPath}/*`;
  res.send(policyTemplate);

}