import { describe, it } from 'mocha';
import { expect } from 'chai';
import { HarmonyEnv, IHarmonyEnv, getValidationErrors, validateEnvironment } from '../env';

describe('Environment validation', function () {

  const validEnvData: IHarmonyEnv = {
    artifactBucket: 'foo',
    awsDefaultRegion: 'us-west-2',
    callbackUrlRoot: 'http://localhost:3000',
    cmrEndpoint: 'http://localhost:3001',
    cmrMaxPageSize: 1,
    databaseType: 'postgres',
    defaultPodGracePeriodSecs: 1,
    defaultResultPageSize: 1,
    harmonyClientId: 'foo',
    largeWorkItemUpdateQueueUrl: 'http://localstack:4566/w.fifo',
    localstackHost: 'localstack',
    logLevel: 'debug',
    maxGranuleLimit: 1,
    nodeEnv: 'production',
    port: 3000,
    queueLongPollingWaitTimeSec: 1,
    sameRegionAccessRole: 'foo',
    workItemSchedulerQueueUrl: 'http://localstack:4566/ws.fifo',
    workItemUpdateQueueUrl: 'http://localstack:4566/wu.fifo',
  } as IHarmonyEnv;

  describe('When the environment is valid', function () {
    const validEnv: HarmonyEnv = new HarmonyEnv(validEnvData);
    it('does not throw an error when validated', function () {
      expect(() => validateEnvironment(validEnv)).not.to.Throw;
    });

    it('does not log any errors', function () {
      expect(getValidationErrors(validEnv).length).to.eql(0);
    });
  });

  describe('When the environment is invalid', function () {
    const invalidEnvData: IHarmonyEnv = { ...validEnvData, ...{ port: -1, callbackUrlRoot: 'foo' } } as IHarmonyEnv;
    const invalidEnv: HarmonyEnv = new HarmonyEnv(invalidEnvData);
    it('throws an error when validated', function () {
      expect(() => validateEnvironment(invalidEnv)).to.throw;
    });

    it('logs two errors', function () {
      expect(getValidationErrors(invalidEnv)).to.eql([
        {
          'children': [],
          'constraints': {
            'isUrl': 'callbackUrlRoot must be a URL address',
          },
          'property': 'callbackUrlRoot',
          'value': 'foo',
        },
        {
          'children': [],
          'constraints': {
            'min': 'port must not be less than 0',
          },
          'property': 'port',
          'value': -1,
        },
      ]);
    });
  });
});