/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import * as sinon from 'sinon';

import * as k8s from '@kubernetes/client-node';

import { RestartPrometheus } from '../app/cronjobs/restart-prometheus';
import { Context } from '../app/util/context';

describe('RestartPrometheus', () => {
  let ctx: Context;
  let loggerStub: {
    debug: sinon.SinonStub;
    info: sinon.SinonStub;
    warn: sinon.SinonStub;
    error: sinon.SinonStub;
  };

  let hpaApiStub: any; // sinon.SinonStubbedInstance<k8s.AutoscalingV2Api>;
  let coreApiStub: any; //sinon.SinonStubbedInstance<k8s.CoreV1Api>;

  beforeEach(() => {
    loggerStub = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    ctx = {
      logger: loggerStub,
    } as unknown as Context;

    hpaApiStub = {
      listNamespacedHorizontalPodAutoscaler: sinon.stub(),
    };

    coreApiStub = {
      listNamespacedPod: sinon.stub(),
      deleteNamespacedPod: sinon.stub(),
    };

    sinon.stub(k8s.KubeConfig.prototype, 'makeApiClient')
      .callsFake((api: any) => {
        if (api === k8s.AutoscalingV2Api) {
          return hpaApiStub;
        } else if (api === k8s.CoreV1Api) {
          return coreApiStub;
        }
        throw new Error(`Unsupported API client: ${api}`);
      });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('run', async () => {
    beforeEach(() => {
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [
          {
            status: {
              currentMetrics: [
                {
                  object: {
                    current: {
                      averageValue: '100m',
                    },
                  },
                },
              ],
            },
          },
        ],
      });
    });

    it('should log debug and call restartPrometheusIfBroken', async () => {
      await RestartPrometheus.run(ctx);
      expect(loggerStub.debug.calledOnceWith('Running')).to.be.true;
      expect(hpaApiStub.listNamespacedHorizontalPodAutoscaler.calledOnceWith({ namespace: 'harmony' })).to.be.true;
      expect(loggerStub.info.calledOnceWith('All 1 HPAs are collecting metrics, Prometheus working as expected.')).to.be.true;
    });

    it('should catch and log any errors', async () => {
      const error = new Error('Test error');
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.rejects(error);
      await RestartPrometheus.run(ctx);

      expect(loggerStub.debug.calledOnceWith('Running')).to.be.true;
      expect(loggerStub.error.calledWith('Failed to monitor and restart Prometheus')).to.be.true;
      expect(loggerStub.error.calledWith(error)).to.be.true;
    });
  });

  describe('restartPrometheusIfBroken', () => {
    it('should do nothing when no HPAs are found', async () => {
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.resolves({ items: [] });

      await RestartPrometheus.run(ctx);

      expect(loggerStub.warn.calledOnceWith('No HPAs found, skipping check to restart Prometheus')).to.be.true;
      expect(coreApiStub.listNamespacedPod.called).to.be.false;
    });

    it('should not restart Prometheus when all HPAs have metrics', async () => {
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [
          {
            status: {
              currentMetrics: [
                {
                  object: {
                    current: {
                      averageValue: '100m',
                    },
                  },
                },
              ],
            },
          },
          {
            status: {
              currentMetrics: [
                {
                  object: {
                    current: {
                      averageValue: '200m',
                    },
                  },
                },
              ],
            },
          },
        ],
      });

      await RestartPrometheus.run(ctx);

      expect(loggerStub.info.calledWith('All 2 HPAs are collecting metrics, Prometheus working as expected.')).to.be.true;
      expect(coreApiStub.listNamespacedPod.called).to.be.false;
    });

    it('should restart Prometheus when an HPA has unknown metrics', async () => {
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [
          {
            status: {
              currentMetrics: [
                {
                  object: {
                    current: {
                      averageValue: null,
                    },
                  },
                },
              ],
            },
          },
        ],
      });

      coreApiStub.listNamespacedPod.resolves({
        items: [
          {
            metadata: {
              name: 'prometheus-server-1234',
            },
          },
        ],
      });

      coreApiStub.deleteNamespacedPod.resolves({});

      await RestartPrometheus.run(ctx);

      expect(loggerStub.warn.calledWith('Detected HPA with unknown targets, restarting Prometheus pod.')).to.be.true;
      expect(coreApiStub.listNamespacedPod.calledWith({ namespace: 'monitoring' })).to.be.true;
      expect(loggerStub.info.calledWith('Deleting Prometheus pod: prometheus-server-1234')).to.be.true;
      expect(coreApiStub.deleteNamespacedPod.calledWith({ name: 'prometheus-server-1234', namespace: 'monitoring' })).to.be.true;
      expect(loggerStub.info.calledWith('Prometheus pod deleted successfully.')).to.be.true;
    });

    it('should handle missing averageValue in HPA metrics', async () => {
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [
          {
            status: {
              currentMetrics: [{ object: { current: {} } }],
            },
          },
        ],
      });

      coreApiStub.listNamespacedPod.resolves({
        items: [
          {
            metadata: {
              name: 'prometheus-server-1234',
            },
          },
        ],
      });

      coreApiStub.deleteNamespacedPod.resolves({});

      await RestartPrometheus.run(ctx);

      expect(loggerStub.warn.calledWith('Detected HPA with unknown targets, restarting Prometheus pod.')).to.be.true;
      expect(coreApiStub.deleteNamespacedPod.called).to.be.true;
    });

    beforeEach(() => {
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [{ status: {} }],
      });
    });

    it('should handle missing status.currentMetrics in HPA', async () => {
      coreApiStub.listNamespacedPod.resolves({
        items: [
          {
            metadata: {
              name: 'prometheus-server-1234',
            },
          },
        ],
      });

      await RestartPrometheus.run(ctx);

      expect(loggerStub.warn.calledWith('Detected HPA with unknown targets, restarting Prometheus pod.')).to.be.true;
      expect(coreApiStub.deleteNamespacedPod.called).to.be.true;
    });

    it('should handle when no Prometheus pod is found', async () => {
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [
          {
            status: {
              currentMetrics: [{ object: { current: {} } }],
            },
          },
        ],
      });

      coreApiStub.listNamespacedPod.resolves({
        items: [
          {
            metadata: {
              name: 'not-prometheus-pod',
            },
          },
        ],
      });

      await RestartPrometheus.run(ctx);

      expect(loggerStub.warn.calledWith('No Prometheus pod found in monitoring namespace.')).to.be.true;
      expect(coreApiStub.deleteNamespacedPod.called).to.be.false;
    });

    it('should handle error when deleting Prometheus pod', async () => {
      hpaApiStub.listNamespacedHorizontalPodAutoscaler.resolves({
        items: [
          {
            status: {
              currentMetrics: [{ object: { current: {} } }],
            },
          },
        ],
      });

      coreApiStub.listNamespacedPod.resolves({
        items: [
          {
            metadata: {
              name: 'prometheus-server-1234',
            },
          },
        ],
      });

      const deleteError = new Error('Delete failed');
      coreApiStub.deleteNamespacedPod.rejects(deleteError);

      await RestartPrometheus.run(ctx);

      expect(loggerStub.info.calledWith('Deleting Prometheus pod: prometheus-server-1234')).to.be.true;
      expect(coreApiStub.deleteNamespacedPod.called).to.be.true;
      expect(loggerStub.error.calledWith('Failed to monitor and restart Prometheus'));
    });
  });
});
