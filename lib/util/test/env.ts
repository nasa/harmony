import { describe, it } from 'mocha';
import { expect } from 'chai';
import { validateSync } from 'class-validator';
import { HarmonyEnv, IHarmonyEnv } from '../env';

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
    const errors = validateSync(validEnv, { validationError: { target: false } });
    console.log(JSON.stringify(errors));
    it('does not return errors when validated', function () {
      expect(errors.length).to.eql(0);
    });
  });

  describe('WHen the environment is invalid', function () {
    const invalidEnvData: IHarmonyEnv = { ...validEnvData, ...{ port: -1 } } as IHarmonyEnv;
    const invalidEnv: HarmonyEnv = new HarmonyEnv(invalidEnvData);
    const errors = validateSync(invalidEnv, { validationError: { target: false } });
    it('returns errors when validated', function () {
      expect(errors).to.eql([{
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