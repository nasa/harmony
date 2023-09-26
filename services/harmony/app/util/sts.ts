import { STSClient, AssumeRoleCommand, AssumeRoleCommandOutput, STSClientConfig,
  AssumeRoleCommandInput,  GetCallerIdentityCommandOutput, GetCallerIdentityCommand,
} from '@aws-sdk/client-sts';
import env from './env';

const { awsDefaultRegion } = env;

export default class SecureTokenService {
  private sts: STSClient;

  constructor(overrides?: STSClientConfig) {
    const endpointSettings: STSClientConfig = {};
    if (process.env.USE_LOCALSTACK === 'true') {
      endpointSettings.endpoint = `http://${env.localstackHost}:4592`;
    }

    this.sts = new STSClient({
      region: awsDefaultRegion,
      ...endpointSettings,
      ...overrides,
    });
  }

  async getCallerIdentity(): Promise<GetCallerIdentityCommandOutput> {
    const command = new GetCallerIdentityCommand({});
    const response = await this.sts.send(command);
    return response;
  }

  async assumeRole(params: AssumeRoleCommandInput): Promise<AssumeRoleCommandOutput> {
    const command = new AssumeRoleCommand(params);
    const response = await this.sts.send(command);
    return response;
  }
}
