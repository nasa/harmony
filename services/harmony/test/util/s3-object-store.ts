/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import sinon from 'sinon';

import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3RequestPresigner } from '@aws-sdk/s3-request-presigner';

import { S3ObjectStore } from '../../app/util/object-store/s3-object-store';

describe('signGetObject', () => {
  let sandbox: sinon.SinonSandbox;
  let s3Client: sinon.SinonStubbedInstance<S3Client>;
  let instance: S3ObjectStore;
  let sendStub: sinon.SinonStub;
  let capturedQuery: any;

  beforeEach(() => {
    // Create a fresh sandbox for every test
    sandbox = sinon.createSandbox();

    // Setup S3 client
    s3Client = new S3Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
    }) as any;

    // Stub send() using sandbox
    sendStub = sandbox.stub(s3Client, 'send');
    (s3Client as any).send = sendStub;

    // Default HeadObjectCommand success
    sendStub.withArgs(sinon.match.instanceOf(HeadObjectCommand)).resolves({});

    // Stub S3RequestPresigner.prototype.presign using sandbox
    capturedQuery = undefined;
    sandbox
      .stub(S3RequestPresigner.prototype, 'presign')
      .callsFake(async (request: any) => {
        capturedQuery = request.query;
        return {
          protocol: 'https:',
          hostname: 'test-bucket.s3.amazonaws.com',
          path: '/file.txt',
          query: request.query,
        } as any;
      });

    // Setup instance
    instance = new S3ObjectStore();
    instance.s3 = s3Client as any;
  });

  afterEach(() => {
    // Restore everything stubbed in this sandbox
    sandbox.restore();
  });

  it('should throw TypeError for non-s3 URLs', async () => {
    const invalidUrl = 'https://example.com/file.txt';
    try {
      await instance.signGetObject(invalidUrl, {});
      expect.fail('Should have thrown TypeError');
    } catch (error: any) {
      expect(error).to.be.instanceOf(TypeError);
      expect(error.message).to.include('Invalid S3 URL');
    }
  });

  it('should add custom query parameters to signed URL', async () => {
    const customParams = {
      'A-userid': 'user123',
      'A-api-request-uuid': 'uuid-456',
      'A-provider': 'test-provider',
      'A-collection-concept-ids': 'C123,C456',
    };

    const result = await instance.signGetObject('s3://test-bucket/file.txt', customParams);

    expect(capturedQuery).to.deep.equal(customParams);
    expect(result).to.include('https://');
  });

  it('should handle HeadObject errors', async () => {
    sendStub.withArgs(sinon.match.instanceOf(HeadObjectCommand)).rejects(new Error('NoSuchKey'));

    try {
      await instance.signGetObject('s3://test-bucket/missing.txt', {});
      expect.fail('Should throw');
    } catch (err: any) {
      expect(err.message).to.include('NoSuchKey');
    }
  });
});
