/* eslint-disable @typescript-eslint/no-explicit-any */

import { S3Client } from '@aws-sdk/client-s3';
import * as k8s from '@kubernetes/client-node';
import axios from 'axios';
import { expect } from 'chai';
import sinon from 'sinon';

import { MemoryUsageCollector } from '../app/cronjobs/memory-usage-collector';
import env from '../app/util/env';

/**
 * Builds a Prometheus instant query response
 * @param value - The single value returned by the query, or undefined for no data
 * @returns the mocked axios response
 */
function promResponse(value?: number): any {
  const result = value === undefined ? [] : [{ metric: {}, value: [1710513000, String(value)] }];
  return { data: { status: 'success', data: { resultType: 'vector', result } } };
}

describe('MemoryUsageCollector', () => {
  let sandbox: sinon.SinonSandbox;
  let ctx: any;
  let autoscalingApiStub: any;
  let appsApiStub: any;
  let axiosGetStub: sinon.SinonStub;

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
    sandbox.stub(S3Client.prototype, 'send' as any);

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
      const mockHPAs = {
        items: [
          { metadata: { name: 'service-1' } },
          { metadata: { name: 'service-2' } },
          { metadata: { name: 'service-3' } },
        ],
      };

      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);

      await MemoryUsageCollector.run(ctx);

      expect(autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.calledOnce).to.be.true;
      expect(ctx.logger.info.calledWith(sinon.match(/Found HPA services/))).to.be.true;
    });

    it('should filter out HPAs without names', async () => {
      const mockHPAs = {
        items: [
          { metadata: { name: 'service-1' } },
          { metadata: {} },
          { metadata: { name: 'service-2' } },
        ],
      };

      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);

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
      const mockHPAs = {
        items: [{ metadata: { name: 'test-service' } }],
      };
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);
    });

    it('should calculate average and maximum memory usage from cAdvisor metrics', async () => {
      const mib = 1024 * 1024;
      axiosGetStub
        .withArgs(sinon.match.any, sinon.match.hasNested('params.query', sinon.match(/container_memory_max_usage_bytes/)))
        .resolves(promResponse(256 * mib));
      axiosGetStub
        .withArgs(sinon.match.any, sinon.match.hasNested('params.query', sinon.match(/container_memory_working_set_bytes/)))
        .resolves(promResponse(128 * mib));

      const mockDeployment = {
        spec: {
          template: {
            spec: {
              containers: [
                { resources: { limits: { memory: '512Mi' } } },
              ],
            },
          },
        },
      };

      appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
      (S3Client.prototype.send as any).resolves({});

      await MemoryUsageCollector.run(ctx);

      sinon.assert.calledTwice(axiosGetStub);
      expect(axiosGetStub.firstCall.args[0]).to.equal('http://prometheus:9090/api/v1/query');
      const queries = axiosGetStub.getCalls().map(c => c.args[1].params.query);
      for (const query of queries) {
        expect(query).to.include('namespace="harmony",pod=~"test-service-[a-z0-9]+-[a-z0-9]+"');
        expect(query).to.include('[60m:1m]');
      }
      expect(appsApiStub.readNamespacedDeployment.calledOnce).to.be.true;

      const payload = JSON.parse((S3Client.prototype.send as any).getCall(0).args[0].input.Body);
      expect(payload['test-service']['Maximum Utilization (%)']).to.equal(50);
      expect(payload['test-service']['Average Utilization (%)']).to.equal(25);
    });

    it('should handle no datapoints returned from Prometheus', async () => {
      axiosGetStub.resolves(promResponse());

      const mockDeployment = {
        spec: {
          template: {
            spec: {
              containers: [
                { resources: { limits: { memory: '512Mi' } } },
              ],
            },
          },
        },
      };

      appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
      (S3Client.prototype.send as any).resolves({});

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.warn.calledWith(sinon.match(/No datapoints returned/))).to.be.true;
    });

    it('should correctly parse different memory limit formats', async () => {
      axiosGetStub.resolves(promResponse(50));

      const testCases = [
        { memory: '512Mi', expectedBytes: 512 * 1024 * 1024 },
        { memory: '1Gi', expectedBytes: 1 * 1024 * 1024 * 1024 },
        { memory: '2048Ki', expectedBytes: 2048 * 1024 },
        { memory: '1073741824', expectedBytes: 1073741824 },
      ];

      for (const testCase of testCases) {
        const mockDeployment = {
          spec: {
            template: {
              spec: {
                containers: [
                  { resources: { limits: { memory: testCase.memory } } },
                ],
              },
            },
          },
        };

        appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
        (S3Client.prototype.send as any).resolves({});

        await MemoryUsageCollector.run(ctx);

        expect(ctx.logger.debug.calledWith(
          sinon.match(new RegExp(`${testCase.expectedBytes} bytes`)),
        )).to.be.true;

        sandbox.resetHistory();
      }
    });

    it('should handle unknown memory limit formats', async () => {
      axiosGetStub.resolves(promResponse(50));

      const mockDeployment = {
        spec: {
          template: {
            spec: {
              containers: [
                { resources: { limits: { memory: '512Mb' } } }, // Invalid format
              ],
            },
          },
        },
      };

      appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
      (S3Client.prototype.send as any).resolves({});

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.warn.calledWith(
        sinon.match(/Unknown memory limit format/),
      )).to.be.true;
    });

    it('should sum memory limits from multiple containers', async () => {
      axiosGetStub.resolves(promResponse(50));

      const mockDeployment = {
        spec: {
          template: {
            spec: {
              containers: [
                { resources: { limits: { memory: '512Mi' } } },
                { resources: { limits: { memory: '256Mi' } } },
                { resources: { limits: { memory: '1Gi' } } },
              ],
            },
          },
        },
      };

      appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
      (S3Client.prototype.send as any).resolves({});

      await MemoryUsageCollector.run(ctx);

      expect(appsApiStub.readNamespacedDeployment.calledOnce).to.be.true;
    });
  });

  describe('saveMemoryUsageToS3', () => {
    it('should save memory usage data to S3 with correct format', async () => {
      const mockHPAs = {
        items: [{ metadata: { name: 'test-service' } }],
      };
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);

      axiosGetStub.resolves(promResponse(50));

      const mockDeployment = {
        spec: {
          template: {
            spec: {
              containers: [
                { resources: { limits: { memory: '1Gi' } } },
              ],
            },
          },
        },
      };

      appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
      (S3Client.prototype.send as any).resolves({});

      await MemoryUsageCollector.run(ctx);

      sinon.assert.calledOnce(S3Client.prototype.send as sinon.SinonStub);

      const s3Call = (S3Client.prototype.send as any).getCall(0);
      const putCommand = s3Call.args[0];

      expect(putCommand.input.Bucket).to.equal('test-bucket');
      expect(putCommand.input.Key).to.match(/^memory-metrics\/test\/\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
      expect(putCommand.input.ContentType).to.equal('application/json');

      const payload = JSON.parse(putCommand.input.Body);
      expect(payload['test-service']).to.have.property('Average Utilization (%)');
      expect(payload['test-service']).to.have.property('Maximum Utilization (%)');
      expect(payload['test-service']).to.have.property('Maximum Usage (GB)');
    });

    it('should format timestamp correctly in UTC', async () => {
      const mockHPAs = {
        items: [{ metadata: { name: 'test-service' } }],
      };
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);

      axiosGetStub.resolves(promResponse(50));

      const mockDeployment = {
        spec: {
          template: {
            spec: {
              containers: [{ resources: { limits: { memory: '1Gi' } } }],
            },
          },
        },
      };

      appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
      (S3Client.prototype.send as any).resolves({});

      const fixedDate = new Date('2024-03-15T14:30:00Z');
      const clock = sandbox.useFakeTimers(fixedDate.getTime());

      await MemoryUsageCollector.run(ctx);

      const s3Call = (S3Client.prototype.send as any).getCall(0);
      const key = s3Call.args[0].input.Key;

      expect(key).to.equal('memory-metrics/test/2024-03-15-1430.json');

      clock.restore();
    });
  });

  describe('MemoryUsageCollector.run', () => {
    it('should complete successfully with valid data', async () => {
      const mockHPAs = {
        items: [
          { metadata: { name: 'service-1' } },
          { metadata: { name: 'service-2' } },
        ],
      };

      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);

      axiosGetStub.resolves(promResponse(50));

      const mockDeployment = {
        spec: {
          template: {
            spec: {
              containers: [{ resources: { limits: { memory: '512Mi' } } }],
            },
          },
        },
      };

      appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
      (S3Client.prototype.send as any).resolves({});

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.info.calledWith('Started memory usage collector cron job')).to.be.true;
      expect(ctx.logger.info.calledWith(sinon.match(/Saved memory usage JSON/))).to.be.true;
      expect(ctx.logger.error.called).to.be.false;
    });

    it('should log error when collection fails', async () => {
      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.rejects(
        new Error('Kubernetes API error'),
      );

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.calledWith('Failed to get memory usage statistics for harmony services')).to.be.true;
      expect(ctx.logger.error.calledWith(sinon.match.instanceOf(Error))).to.be.true;
    });

    it('should handle Prometheus API errors gracefully', async () => {
      const mockHPAs = {
        items: [{ metadata: { name: 'test-service' } }],
      };

      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);
      axiosGetStub.rejects(new Error('Prometheus API error'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.called).to.be.true;
    });

    it('should log error when the Prometheus query is unsuccessful', async () => {
      const mockHPAs = {
        items: [{ metadata: { name: 'test-service' } }],
      };

      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);
      axiosGetStub.resolves({ data: { status: 'error', error: 'bad query' } });

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.calledWith(sinon.match.has('message', 'Prometheus query failed: bad query'))).to.be.true;
      expect((S3Client.prototype.send as any).called).to.be.false;
    });

    it('should handle S3 API errors gracefully', async () => {
      const mockHPAs = {
        items: [{ metadata: { name: 'test-service' } }],
      };

      autoscalingApiStub.listNamespacedHorizontalPodAutoscaler.resolves(mockHPAs);

      axiosGetStub.resolves(promResponse(50));

      const mockDeployment = {
        spec: {
          template: {
            spec: {
              containers: [{ resources: { limits: { memory: '512Mi' } } }],
            },
          },
        },
      };

      appsApiStub.readNamespacedDeployment.resolves(mockDeployment);
      (S3Client.prototype.send as any).rejects(new Error('S3 API error'));

      await MemoryUsageCollector.run(ctx);

      expect(ctx.logger.error.called).to.be.true;
    });
  });
});
