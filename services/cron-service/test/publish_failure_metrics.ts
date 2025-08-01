import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';

import {
  CloudWatchClient, PutMetricDataCommand, PutMetricDataCommandInput,
} from '@aws-sdk/client-cloudwatch';

import { WorkItemStatus } from '../../harmony/app/models/work-item-interface';
import db from '../../harmony/app/util/db';
import * as pfm from '../app/cronjobs/publish-failure-metrics';
import { Context } from '../app/util/context';
import env from '../app/util/env';
import { hookTransaction, truncateAll } from './helpers/db';
import { buildWorkItem } from './helpers/work-items';

describe('PublishFailureMetrics', () => {
  let ctx: Context;
  let loggerInfoStub: sinon.SinonStub;
  let loggerErrorStub: sinon.SinonStub;
  let loggerWarnStub: sinon.SinonStub;

  beforeEach(async () => {
    loggerInfoStub = sinon.stub();
    loggerErrorStub = sinon.stub();
    loggerWarnStub = sinon.stub();

    // Set up context with real database
    ctx = {
      logger: {
        info: loggerInfoStub,
        error: loggerErrorStub,
        warn: loggerWarnStub,
      },
      db: db,
    } as unknown as Context;

    env.userWorkExpirationMinutes = 60;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('PublishServiceFailureMetrics.run', () => {
    const service = 'harmonyservices/query-cmr';
    const percentFailure = 75;

    let getConfigStub: SinonStub;
    let getMetricsStub: SinonStub;
    let publishStub: SinonStub;
    let clientIdStub: SinonStub;

    beforeEach(() => {
      getConfigStub = sinon.stub(pfm, 'getCloudWatchClientConfig');
      getMetricsStub = sinon.stub(pfm, 'getFailedWorkItemPercentageByServiceWithTimeWindow');
      publishStub = sinon.stub(pfm, 'publishMetric');
      clientIdStub = sinon.stub(env, 'clientId').get(() => 'harmony-test');
    });

    afterEach(() => {
      getConfigStub.restore();
      getMetricsStub.restore();
      publishStub.restore();
      clientIdStub.restore();
    });


    it('should call logger.info', async () => {
      await pfm.PublishServiceFailureMetrics.run(ctx);
      expect(loggerInfoStub.calledWith('Failure metrics publisher started.')).to.be.true;
    });

    const error = new Error('Database error');

    it('should log errors when getting metrics fails', async () => {
      loggerErrorStub.reset();
      getMetricsStub.rejects(error);

      try {

        await pfm.PublishServiceFailureMetrics.run(ctx);

      } finally {
        expect(loggerErrorStub.called).to.be.true;
        expect(loggerErrorStub.calledWith('Failed to compute and publish all service failure metrics')).to.be.true;
      }
    });

    it('should use a metrics namespace that includes the environment', async () => {
      getMetricsStub.resolves([{ service, percent: percentFailure }]);
      await pfm.PublishServiceFailureMetrics.run(ctx);
      const firstCallArgs = publishStub.getCall(0);
      expect(firstCallArgs.args[2].namespace).to.equal('harmony-services-harmony-test');
    });

    it('should use a proper metric name', async () => {
      getMetricsStub.resolves([{ service, percent: percentFailure }]);
      await pfm.PublishServiceFailureMetrics.run(ctx);
      const firstCallArgs = publishStub.getCall(0);
      expect(firstCallArgs.args[2].metricName).to.equal('harmony-service-percent-failures');
    });

    it('should set the metric value', async () => {
      getMetricsStub.resolves([{ service, percent: percentFailure }]);
      await pfm.PublishServiceFailureMetrics.run(ctx);
      const firstCallArgs = publishStub.getCall(0);
      expect(firstCallArgs.args[2].value).to.equal(percentFailure);
    });

    it('should provide the service name in the dimensions', async () => {
      getMetricsStub.resolves([{ service, percent: percentFailure }]);
      await pfm.PublishServiceFailureMetrics.run(ctx);
      const firstCallArgs = publishStub.getCall(0);
      expect(firstCallArgs.args[2].dimensions.service).to.equal(service);
    });
  });

  describe('getCloudWatchClientConfig', function () {
    let useLocalstack;
    before(() => {
      useLocalstack = process.env.USE_LOCALSTACK;
    });
    after(() => {
      process.env.USE_LOCALSTACK = useLocalstack;
    });

    it('uses localstack when asked', function () {
      const localstackHost = 'localhost';
      process.env.USE_LOCALSTACK = 'true';
      const localstackHostStub = sinon.stub(env, 'localstackHost').get(() => localstackHost);
      const config = pfm.getCloudWatchClientConfig();
      expect(config.endpoint).to.equal(`http://${localstackHost}:4572`);
      expect(config.credentials.accessKeyId).to.equal('localstack');
      expect(config.credentials.secretAccessKey).to.equal('localstack');
      localstackHostStub.restore();
    });

    it('does not uses localstack when asked not to', function () {
      process.env.USE_LOCALSTACK = 'false';
      const config = pfm.getCloudWatchClientConfig();
      expect(config.endpoint).to.be.undefined;
      expect(config.credentials).to.be.undefined;
    });

    it('sets the region for the environment', function () {
      const config = pfm.getCloudWatchClientConfig();
      expect(config.region).to.equal(env.awsDefaultRegion);
    });
  });

  describe('getFailedWorkItemPercentageByServiceWithTimeWindow', () => {
    hookTransaction();

    before(async function () {
    // 50 percent failures
      const failedItem1 = buildWorkItem({ status: WorkItemStatus.FAILED });
      await failedItem1.save(this.trx);
      const failedItem2 = buildWorkItem({ status: WorkItemStatus.FAILED });
      await failedItem2.save(this.trx);
      const successfulWorkItem = buildWorkItem({ status: WorkItemStatus.SUCCESSFUL });
      await successfulWorkItem.save(this.trx);
      const warningWorkItem = buildWorkItem({ status: WorkItemStatus.WARNING });
      await warningWorkItem.save(this.trx);
      this.trx.commit();
    });

    after(async function () {
      await truncateAll();
    });

    it('computes the percentage of failures for each service', async () => {
      const metrics = await pfm.getFailedWorkItemPercentageByServiceWithTimeWindow(ctx);
      expect(metrics[0].service).to.equal('harmony-services/query-cmr');
      expect(metrics[0].percent).to.equal(50);
    });
  });

  describe('publishMetric', () => {
    const config = pfm.getCloudWatchClientConfig();
    const client = new CloudWatchClient(config);
    let sendStub: sinon.SinonStub;
    before(() => {
      sendStub = sinon.stub(client, 'send').resolves();
    });
    after(() => {
      sendStub.restore();
    });

    it('sends the metric to CloudWatch', async () => {
      const metricName = 'harmony-service-percent-failures';
      const namespace = 'harmony-test';
      const service = 'harmonyservices/query-cmr';
      const now = new Date();
      const value = 50;
      const metricData: pfm.MetricData = {
        metricName,
        namespace,
        value: value,
        dimensions: {
          'service': service,
        },
        timestamp: now,
      };
      const params: PutMetricDataCommandInput = {
        Namespace: namespace,
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: 'Percent',
            Timestamp: now,
            Dimensions: [{ Name: service, Value: value.toString() }],
          },
        ],
      };
      const expectedCommand = new PutMetricDataCommand(params);
      await pfm.publishMetric(ctx, client, metricData);
      expect(sendStub.calledWith(expectedCommand));
    });
  });
});
