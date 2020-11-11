import aws from 'aws-sdk';

import env = require('./env');

export interface ImageDetails {
  imageDigest: string;
  lastUpdated: Date;
}

export class ECR {
  ecr: aws.ECR;

  /**
   * Builds and returns an Elastic container registry object for interacting with the
   * AWS SDK.
   *
   * @param overrides values to set when constructing the underlying ECR.
   */
  constructor(overrides?: object) {
    this.ecr = this._getECR(overrides);
  }

  _getECR(overrides?): aws.ECR {
    const endpointSettings: aws.ECR.ClientConfiguration = {};
    if (process.env.USE_LOCALSTACK === 'true') {
      aws.config.update({
        region: env.awsDefaultRegion,
        credentials: { accessKeyId: 'localstack', secretAccessKey: 'localstack' },
      });
      endpointSettings.endpoint = `http://${env.localstackHost}:4566`;
    }

    return new aws.ECR({
      apiVersion: '2015-09-21',
      region: env.awsDefaultRegion,
      ...endpointSettings,
      ...overrides,
    });
  }

  /**
   * Returns image information from ECR for the given image repository and tag
   * @param repository - the image repository (e.g. harmony/gdal)
   * @param tag - the image tag
   */
  async describeImage(repository: string, tag: string): Promise<ImageDetails> {
    const response = await this.ecr
      .describeImages({ repositoryName: repository, imageIds: [{ imageTag: tag }] })
      .promise();

    const image = response.imageDetails[0];

    return {
      imageDigest: image.imageDigest,
      lastUpdated: new Date(image.imagePushedAt),
    };
  }
}

/**
 * Returns the default object store for this instance of Harmony.  Allows requesting an
 * object store without first knowing a protocol.
 *
 * @returns the default object store for Harmony.
 */
export function defaultContainerRegistry(): ECR {
  return new ECR({});
}
