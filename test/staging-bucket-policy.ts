import AWS from 'aws-sdk';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import request from 'supertest';
import { stub, SinonStub } from 'sinon';
import { hookRequest } from './helpers/hooks';
import hookServersStartStop from './helpers/servers';

/**
 * Calls the staging-bucket-policy endpoint to get a bucket policy for the given bucket/path
 *
 * @param app - The express application (typically this.frontend)
 * @param bucketNamePath - the bucket name and optional path (url encoded)
 * @returns the response
 */
function stagingBucketPolicy(app: Express.Application, { bucketNamePath }): request.Test {
  return request(app).get(`/staging-bucket-policy/${bucketNamePath}`);
}

const hookStagingBucketPolicy = hookRequest.bind(this, stagingBucketPolicy);

const simpleBucketPolicy = {
  'Version': '2012-10-17',
  'Statement': [
    {
      'Sid': 'write permission',
      'Effect': 'Allow',
      'Principal': {
        'AWS': 'arn:aws:iam::123456789012:root',
      },
      'Action': 's3:PutObject',
      'Resource': 'arn:aws:s3:::my-bucket/*',
    },
    {
      'Sid': 'get bucket location permission',
      'Effect': 'Allow',
      'Principal': {
        'AWS': 'arn:aws:iam::123456789012:root',
      },
      'Action': 's3:GetBucketLocation',
      'Resource': 'arn:aws:s3:::my-bucket',
    },
  ],
};

const withPrefixBucketPolicy = {
  'Version': '2012-10-17',
  'Statement': [
    {
      'Sid': 'write permission',
      'Effect': 'Allow',
      'Principal': {
        'AWS': 'arn:aws:iam::123456789012:root',
      },
      'Action': 's3:PutObject',
      'Resource': 'arn:aws:s3:::my-bucket/my-prefix/*',
    },
    {
      'Sid': 'get bucket location permission',
      'Effect': 'Allow',
      'Principal': {
        'AWS': 'arn:aws:iam::123456789012:root',
      },
      'Action': 's3:GetBucketLocation',
      'Resource': 'arn:aws:s3:::my-bucket',
    },
  ],
};

describe('staging-bucket-policy route', function () {
  hookServersStartStop();
  describe('when a user accesses the staging-bucket-policy route on a server in AWS', function () {
    let getCallerIdentityStub: SinonStub;
    before(function () {
      getCallerIdentityStub = stub(AWS, 'STS')
        .returns({
          getCallerIdentity: () => {
            return {
              promise: () => {
                return {
                  Account: '123456789012',
                  Arn: 'arn:aws:iam::123456789012:role/harmony-sandbox-role',
                };
              },
            };
          },
        });
    });
    after(function (){
      getCallerIdentityStub.restore();
    });
    describe('and the user provides a valid s3 bucket with no prefix', async function () {
      hookStagingBucketPolicy({ bucketNamePath: 'my-bucket' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(simpleBucketPolicy);
      });
    });

    describe('and the user provides a valid s3 bucket with no prefix ending in \'/\'', async function () {
      hookStagingBucketPolicy({ bucketNamePath: 'my-bucket/' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(simpleBucketPolicy);
      });
    });

    describe('and the user provides a valid s3 bucket with a prefix', async function () {
      hookStagingBucketPolicy({ bucketNamePath: 'my-bucket%2Fmy-prefix' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(withPrefixBucketPolicy);
      });
    });

    describe('and the user provides a valid s3 bucket with a prefix ending in \'/\'', async function () {
      hookStagingBucketPolicy({ bucketNamePath: 'my-bucket%2Fmy-prefix%2F' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(withPrefixBucketPolicy);
      });
    });

    describe('and the user provides an invalid bucket path', async function () {
      hookStagingBucketPolicy({ bucketNamePath: 'my-bucket%2F%2Ffoo' });
      it('returns a 400 error', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns an appropriate error message', function () {
        const error = JSON.parse(this.res.text);
        expect(error.description).to.eql('Error: \'my-bucket//foo\' is not a valid bucket name with optional path');
      });
    });
  });

  describe('when a user accesses the staging-bucket-policy route on a server not in AWS', function () {

    describe('and the user provides a valid s3 bucket path', async function () {
      hookStagingBucketPolicy({ bucketNamePath: 'my-bucket' });
      it('returns a 400 error', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns an appropriate error message', function () {
        const error = JSON.parse(this.res.text);
        expect(error.description).to.eql('Error: Failed to generate bucket policy. Bucket policy generation is only available on AWS Harmony deployments');
      });
    });
  });
});