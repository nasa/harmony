import { expect } from 'chai';
import { describe, it } from 'mocha';
import request from 'supertest';
import { stub, SinonStub } from 'sinon';
import { hookRequest } from './helpers/hooks';
import hookServersStartStop from './helpers/servers';
import sts from '../app/util/sts';

/**
 * Calls the staging-bucket-policy endpoint to get a bucket policy for the given bucket/path
 *
 * @param app - The express application (typically this.frontend)
 * @param bucketPath - the bucket name and optional path (url encoded)
 * @returns the response
 */
function stagingBucketPolicy(app: Express.Application, bucketPath): request.Test {
  let req = request(app).get('/staging-bucket-policy');
  if (bucketPath) {
    req = req.query(bucketPath);
  }
  return req;
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

      const expectedResult = {
        $metadata: {},
        Account: '123456789012',
        Arn: 'arn:aws:iam::123456789012:role/harmony-sandbox-role',
      };

      getCallerIdentityStub = stub(sts.prototype, 'getCallerIdentity').resolves(expectedResult);
    });
    after(function () {
      getCallerIdentityStub.restore();
    });
    describe('and the user provides a valid s3 bucket with no prefix', async function () {
      hookStagingBucketPolicy({ bucketPath: 'my-bucket' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(simpleBucketPolicy);
      });
    });

    describe('and the user provides a valid s3 bucket with no prefix ending in \'/\'', async function () {
      hookStagingBucketPolicy({ bucketPath: 'my-bucket/' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(simpleBucketPolicy);
      });
    });

    describe('and the user provides a valid s3 bucket with a prefix', async function () {
      hookStagingBucketPolicy({ bucketPath: 'my-bucket/my-prefix' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(withPrefixBucketPolicy);
      });
    });

    describe('and the user provides a valid s3 bucket with a prefix ending in \'/\'', async function () {
      hookStagingBucketPolicy({ bucketPath: 'my-bucket/my-prefix/' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(withPrefixBucketPolicy);
      });
    });

    describe('and the user provides a valid s3 url with a prefix', async function () {
      hookStagingBucketPolicy({ bucketPath: 's3://my-bucket/my-prefix' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an appropriate bucket policy', function () {
        const policy = JSON.parse(this.res.text);
        expect(policy).to.eql(withPrefixBucketPolicy);
      });
    });

    describe('and the user provides no bucket path', async function () {
      hookStagingBucketPolicy();
      it('returns a 400 error', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns an appropriate error message', function () {
        const error = JSON.parse(this.res.text);
        expect(error.description).to.eql('Error: `bucketPath` is a required parameter that must consist of one of a bucket name, e.g., `my-bucket`, a bucket name plus path/key, e.g., `my-bucket/my/path`, or a full S3 url, e.g., `s3://my-bucket/my/path`.');
      });
    });

    describe('and the user provides an invalid bucket path', async function () {
      describe('due to repeated forward slashes', async function () {
        hookStagingBucketPolicy({ bucketPath: 'my-bucket//foo' });
        it('returns a 400 error', function () {
          expect(this.res.statusCode).to.equal(400);
        });

        it('returns an appropriate error message', function () {
          const error = JSON.parse(this.res.text);
          expect(error.description).to.eql('Error: bucketPath parameter value contains repeated forward slashes (//)');
        });
      });

      describe('due to unsupported characters', async function () {
        hookStagingBucketPolicy({ bucketPath: '\'"/></script><script>function(){qxss6sxG94mr};</script>' });
        it('returns a 400 error', function () {
          expect(this.res.statusCode).to.equal(400);
        });

        it('returns an appropriate error message', function () {
          const error = JSON.parse(this.res.text);
          expect(error.description).to.eql('Error: bucketPath parameter value contains unsupported characters');
        });
      });
    });
  });

  describe('when a user accesses the staging-bucket-policy route on a server not in AWS', function () {
    let getCallerIdentityStub: SinonStub;
    before(function () {
      getCallerIdentityStub = stub(sts.prototype, 'getCallerIdentity')
        .throws('This is not AWS');
    });
    after(function () {
      getCallerIdentityStub.restore();
    });
    describe('and the user provides a valid s3 bucket path', async function () {
      hookStagingBucketPolicy({ bucketPath: 'my-bucket' });
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