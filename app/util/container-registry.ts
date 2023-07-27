import { ECRClient, DescribeImagesCommand, ECRClientConfig } from '@aws-sdk/client-ecr';
import { env } from '@harmony/util';

export interface ImageDetails {
  imageDigest: string;
  lastUpdated: Date;
}

export class ECR {
  private ecr: ECRClient;

  /**
   * Builds and returns an Elastic Container Registry object for interacting with the
   * AWS SDK.
   *
   * @param overrides - values to set when constructing the underlying ECR.
   */
  constructor(overrides?: object) {
    this.ecr = this._getECR(overrides);
  }

  /**
   * Returns a new ECR client object.
   *
   * @param overrides - values to set when constructing the underlying ECR.
   */
  private _getECR(overrides?: object): ECRClient {
    const endpointSettings: ECRClientConfig = {};
    if (env.useLocalstack === true) {
      endpointSettings.endpoint = `http://${env.localstackHost}:4566`;
    }

    return new ECRClient({
      region: env.awsDefaultRegion,
      ...endpointSettings,
      ...overrides,
    });
  }

  /**
   * Returns image information from ECR for the given image repository and tag.
   * @param repository - the image repository (e.g. harmonyservices/service-example)
   * @param tag - the image tag
   */
  async describeImage(repository: string, tag: string): Promise<ImageDetails> {
    const command = new DescribeImagesCommand({
      repositoryName: repository,
      imageIds: [{ imageTag: tag }],
    });
    const response = await this.ecr.send(command);

    const image = response.imageDetails[0];

    return {
      imageDigest: image.imageDigest,
      lastUpdated: new Date(image.imagePushedAt),
    };
  }
}

/**
 * Returns the default container registry for this instance of Harmony.
 *
 * @returns the default container registry for Harmony.
 */
export function defaultContainerRegistry(): ECR {
  return new ECR({});
}
