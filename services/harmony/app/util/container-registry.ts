import { ECRClient, DescribeImagesCommand, ECRClientConfig, DescribeImagesCommandInput } from '@aws-sdk/client-ecr';
import env from './env';

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
   * @param registryId - the registry ID/AWS account ID where the image lives (optional -- may
   * not always be available)
   * @returns A Promise containing ImageDetails or null if the image/tag does not exist
   */
  async describeImage(repository: string, tag: string, registryId?: string): Promise<ImageDetails> {
    let cmd: DescribeImagesCommandInput = {
      repositoryName: repository,
      imageIds: [{ imageTag: tag }],
    };
    if (registryId) {
      cmd = { ...cmd, registryId };
    }
    const command = new DescribeImagesCommand(cmd);
    let response;
    try {
      response = await this.ecr.send(command);
    } catch (e) {
      // The `send` command will throw an exception if the image does not exist.
      // We handle this by returning `null`. Any other exceptions are re-thrown.
      if (e instanceof Error && e.message.includes('does not exist')) {
        return null;
      }
      throw e;
    }

    if (response.imageDetails) {
      const image = response.imageDetails[0];

      return {
        imageDigest: image.imageDigest,
        lastUpdated: new Date(image.imagePushedAt),
      };
    }
    return null;
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
