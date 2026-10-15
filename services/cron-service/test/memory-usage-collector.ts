/* eslint-disable @typescript-eslint/no-explicit-any */

import { S3Client } from '@aws-sdk/client-s3';
import * as k8s from '@kubernetes/client-node';
import axios from 'axios';
import { expect } from 'chai';
import sinon from 'sinon';

import { MemoryUsageCollector } from '../app/cronjobs/memory-usage-collector';
import env from '../app/util/env';

const MIB = 1024 * 1024;

/**
 * Builds a Prometheus instant query response
 * @param value - The single value returned by the query, or undefined for no data
 * @returns the mocked axios response
 */
function promResponse(value?: number): any {
  const result = value === undefined ? [] : [{ metric: {}, value: [1710513000, String(value)] }];
  return { data: { status: 'success', data: { resultType: 'vector', result } } };
}

/**
 * Builds a mocked HPA that scales a deployment with the same name
 * @param name - The HPA and deployment name
 * @returns the mocked HPA
 */
function hpa(name: string): any {
  return { metadata: { name }, spec: { scaleTargetRef: { name } } };
}

/**
 * Builds a mocked backend service deployment with worker and manager containers
 * @param workerLimit - The memory limit of the worker container
 * @param managerLimit - The memory limit of the manager container
 * @returns the mocked deployment
 */
function deployment(workerLimit?: string, managerLimit?: string): any {
  const container = (name: string, memory?: string): any => (
    memory ? { name, resources: { limits: { memory } } } : { name }
  );
  return {
    spec: {
      template: {
        spec: {
          containers: [container('worker', workerLimit), container('manager', managerLimit)],
        },
      },
    },
  };
}

/**
 * Stubs a Prometheus response for each metric and container combination
 * @param axiosGetStub - The stubbed axios.get
 * @param values - Map of `${metric}:${container}` to the value to return
 */
function stubPrometheus(axiosGetStub: sinon.SinonStub, values: Record<string, number>): void {
  for (const [key, value] of Object.entries(values)) {
    const [metric, container] = key.split(':');
    axiosGetStub
      .withArgs(sinon.match.any, sinon.match.hasNested('params.query', sinon.match((q: string) =>
        q.includes(metric) && q.includes(`container="${container}"`))))
      .resolves(promResponse(value));
  }
}

describe('MemoryUsageCollector', () => {
  let sandbox: sinon.SinonSandbox;
  let ctx: any;
  let autoscalingApiStub: any;
  let appsApiStub: any;
  let axiosGetStub: sinon.SinonStub;
  let s3SendStub: sinon.SinonStub;

  /**
   * Parses the JSON payload that was written to S3
   * @returns the payload
   */
  function savedPayload(): any {
    return JSON.parse(s3SendStub.getCall(0).args[0].input.Body);
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    ctx = {
      logger: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      },
    };

    autoscalingApiStub = {
      listNamespacedHorizontalPodAutoscaler: sandbox.stub(),
    };

    appsApiStub = {
      readNamespacedDeployment: sandbox.stub(),
    };

    sandbox.stub(k8s.KubeConfig.prototype, 'loadFromDefault');
    sandbox.stub(k8s.KubeConfig.prototype, 'makeApiClient').callsFake((apiType: any) => {
      if (apiType === k8s.AutoscalingV2Api) {
        return autoscalingApiStub;
      }
      if (apiType === k8s.AppsV1Api) {
        return appsApiStub;
      }
      return null;
    });

    axiosGetStub = sandbox.stub(axios, 'get');
    s3SendStub = sandbox.stub(S3Client.prototype, 'send' as any).resolves({});

    sandbox.stub(env, 'harmonyEnvironment').value('test');
    sandbox.stub(env, 'memoryUsageBucket').value('test-bucket');
    sandbox.stub(env, 'memoryUsagePrometheusUrl').value('http://prometheus:9090');
    sandbox.stub(env, 'memoryUsageCollectorLookBackMinutes').value(60);
    process.env.AWS_DEFAULT_REGION = 'us-west-2';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getListOfBackendServices', () => {
    it('should return list of service names from HPAs', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [hpa('service-1'), hpa('service-2'), hpa('service-3')],
      });
      axiosGetStub.resolves(promResponse(50));
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mi', '512Mi'));

      await MemoryUsageCollector.run(ctx);

      expect(autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.calledOnce).to.be.true;
      expect(ctx.logger.info.calledWith('Found HPA services: service-1, service-2, service-3')).to.be.true;
    });

    it('should filter out HPAs without names or scale targets', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [
          hpa('service-1'),
          { metadata: {}, spec: { scaleTargetRef: { name: 'no-name' } } },
          { metadata: { name: 'no-target' } },
          hpa('service-2'),
        ],
      });
      axiosGetStub.resolves(promResponse(50));
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mi', '512Mi'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.info.calledWith('Found HPA services: service-1, service-2')).to.be.true;
    });

    it('should throw error when no HPAs found', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({ items: [] });

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.calledWith(sinon.match(/Failed to get memory usage/))).to.be.true;
    });
  });

  describe('getMemoryUsageByService', () => {
    beforeEach(() => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({ items: [hpa('test-service')] });
    });

    it('should query each container separately and report usage against that container\'s limit', async () => {
      stubPrometheus(axiosGetStub, {
        'container_memory_max_usage_bytes:worker': 256 * MIB,
        'container_memory_working_set_bytes:worker': 128 * MIB,
        'container_memory_max_usage_bytes:manager': 192 * MIB,
        'container_memory_working_set_bytes:manager': 64 * MIB,
      });
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mi', '256Mi'));

      await MemoryUsageCollector.run(ctx);

      // max and avg queries for each of the worker and manager containers
      sinon.assert.callCount(axiosGetStub, 4);
      expect(axiosGetStub.firstCall.args[0]).to.equal('http://prometheus:9090/api/v1/query');
      const queries: string[] = axiosGetStub.getCalls().map(c => c.args[1].params.query);
      for (const query of queries) {
        expect(query).to.include('namespace="harmony",pod=~"^test-service-[a-z0-9]+-[a-z0-9]+$"');
        expect(query).to.include('[60m:1m]');
      }
      expect(queries.filter(q => q.includes('container="worker"'))).to.have.length(2);
      expect(queries.filter(q => q.includes('container="manager"'))).to.have.length(2);

      const payload = savedPayload();
      expect(Object.keys(payload)).to.have.members(['test-service (worker)', 'test-service (manager)']);
      expect(payload['test-service (worker)']['Maximum Utilization (%)']).to.equal(50);
      expect(payload['test-service (worker)']['Average Utilization (%)']).to.equal(25);
      expect(payload['test-service (manager)']['Maximum Utilization (%)']).to.equal(75);
      expect(payload['test-service (manager)']['Average Utilization (%)']).to.equal(25);
    });

    it('should only match pods of the deployment itself, not similarly named deployments', async () => {
      axiosGetStub.resolves(promResponse(50));
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mi', '512Mi'));

      await MemoryUsageCollector.run(ctx);

      const { query } = axiosGetStub.firstCall.args[1].params;
      const podRegex = new RegExp(query.match(/pod=~"([^"]+)"/)[1]);
      expect(podRegex.test('test-service-6d647bb89b-sjtg4')).to.be.true;
      expect(podRegex.test('test-service-on-demand-6bf4b46d7d-ws7nw')).to.be.false;
    });

    it('should handle no datapoints returned from Prometheus', async () => {
      axiosGetStub.resolves(promResponse());
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mi', '512Mi'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.warn.calledWith(
        sinon.match(/No datapoints returned for service test-service container worker/),
      )).to.be.true;
      expect(ctx.logger.warn.calledWith(
        sinon.match(/No datapoints returned for service test-service container manager/),
      )).to.be.true;
      expect(savedPayload()['test-service (worker)']['Maximum Usage (GB)']).to.equal(0);
    });

    const limitFormats = [
      { memory: '512Mi', bytes: 512 * MIB },
      { memory: '1Gi', bytes: 1024 * MIB },
      { memory: '2048Ki', bytes: 2048 * 1024 },
      { memory: '1073741824', bytes: 1073741824 },
    ];
    limitFormats.forEach(({ memory, bytes }) => {
      it(`should correctly parse a memory limit of ${memory}`, async () => {
        axiosGetStub.resolves(promResponse(bytes / 2));
        appsApiStub.readNamespacedDeployment.resolves(deployment(memory, memory));

        await MemoryUsageCollector.run(ctx);

        expect(savedPayload()['test-service (worker)']['Maximum Utilization (%)']).to.equal(50);
      });
    });

    it('should handle unknown memory limit formats', async () => {
      axiosGetStub.resolves(promResponse(50));
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mb', '512Mi'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.warn.calledWith(sinon.match(/Unknown memory limit "512Mb"/))).to.be.true;
      expect(savedPayload()['test-service (worker)']['Maximum Utilization (%)']).to.equal(0);
    });

    it('should report 0% utilization for a container with no memory limit', async () => {
      axiosGetStub.resolves(promResponse(50));
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mi'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.debug.calledWith(sinon.match(/Container manager has no memory limit/))).to.be.true;
      expect(savedPayload()['test-service (manager)']['Maximum Utilization (%)']).to.equal(0);
    });
  });

  describe('saveMemoryUsageToS3', () => {
    beforeEach(() => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({ items: [hpa('test-service')] });
      axiosGetStub.resolves(promResponse(50));
      appsApiStub.readNamespacedDeployment.resolves(deployment('1Gi', '512Mi'));
    });

    it('should save memory usage data to S3 with correct format', async () => {
      await MemoryUsageCollector.run(ctx);

      sinon.assert.calledOnce(s3SendStub);

      const putCommand = s3SendStub.getCall(0).args[0];
      expect(putCommand.input.Bucket).to.equal('test-bucket');
      expect(putCommand.input.Key).to.match(/^memory-metrics\/test\/\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
      expect(putCommand.input.ContentType).to.equal('application/json');

      const payload = JSON.parse(putCommand.input.Body);
      for (const key of ['test-service (worker)', 'test-service (manager)']) {
        expect(payload[key]).to.have.all.keys(
          'Average Utilization (%)', 'Maximum Utilization (%)', 'Maximum Usage (GB)',
        );
      }
    });

    it('should format timestamp correctly in UTC', async () => {
      const clock = sandbox.useFakeTimers(new Date('2024-03-15T14:30:00Z').getTime());

      await MemoryUsageCollector.run(ctx);

      expect(s3SendStub.getCall(0).args[0].input.Key).to.equal('memory-metrics/test/2024-03-15-1430.json');

      clock.restore();
    });
  });

  describe('MemoryUsageCollector.run', () => {
    it('should complete successfully with valid data', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [hpa('service-1'), hpa('service-2')],
      });
      axiosGetStub.resolves(promResponse(50));
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mi', '512Mi'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.info.calledWith('Started memory usage collector cron job')).to.be.true;
      expect(ctx.logger.info.calledWith(sinon.match(/Saved memory usage JSON/))).to.be.true;
      expect(ctx.logger.error.called).to.be.false;
      expect(Object.keys(savedPayload())).to.have.members([
        'service-1 (worker)', 'service-1 (manager)', 'service-2 (worker)', 'service-2 (manager)',
      ]);
    });

    it('should log error when collection fails', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.rejects(new Error('Kubernetes API error'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.calledWith('Failed to get memory usage statistics for harmony services')).to.be.true;
      expect(ctx.logger.error.calledWith(sinon.match.instanceOf(Error))).to.be.true;
    });

    it('should handle Prometheus API errors gracefully', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({ items: [hpa('test-service')] });
      axiosGetStub.rejects(new Error('Prometheus API error'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.calledWith(sinon.match.has('message', 'Prometheus API error'))).to.be.true;
      expect(s3SendStub.called).to.be.false;
    });

    it('should log error when the Prometheus query is unsuccessful', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({ items: [hpa('test-service')] });
      axiosGetStub.resolves({ data: { status: 'error', error: 'bad query' } });

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.calledWith(sinon.match.has('message', 'Prometheus query failed: bad query'))).to.be.true;
      expect(s3SendStub.called).to.be.false;
    });

    it('should handle S3 API errors gracefully', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves({ items: [hpa('test-service')] });
      axiosGetStub.resolves(promResponse(50));
      appsApiStub.readNamespacedDeployment.resolves(deployment('512Mi', '512Mi'));
      s3SendStub.rejects(new Error('S3 API error'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.calledWith(sinon.match.has('message', 'S3 API error'))).to.be.true;
    });
  });
});
