import { describe } from 'mocha';
import * as fc from 'fast-check';
import { stub } from 'sinon';
import ArgoService, { ArgoServiceParams } from '../app/models/services/argo-service';
import { ServiceConfig } from '../app/models/services/base-service';
import DataOperation from '../app/models/data-operation';
import env from '../app/util/env';

describe('ArgoService utility functions property based tests', function () {
  describe('chooseBatchSize', function () {
    it('Should choose the minimum of the maxGranuleLimit, config.batch_size, operation maxResults', function () {
      fc.assert(
        fc.property(
          fc.integer(1, Number.MAX_SAFE_INTEGER),
          fc.option(fc.integer(1, Number.MAX_SAFE_INTEGER)),
          fc.integer(0, Number.MAX_SAFE_INTEGER),
          (pMaxGranules, pOpMaxResults, pConfigBatchSize) => {
            const [
              maxGranules,
              opMaxResults,
              configBatchSize,
            ] = [pMaxGranules, pOpMaxResults, pConfigBatchSize].map((p) => p && p.valueOf());
            const cBatchSizeNorm = configBatchSize <= 0 ? Number.MAX_SAFE_INTEGER : configBatchSize;
            const config: ServiceConfig<ArgoServiceParams> = {
              batch_size: configBatchSize,
            };
            const op = {
              maxResults: opMaxResults,
            } as DataOperation;
            const service = new ArgoService(config, op);
            const stubEnv = stub(env, 'defaultBatchSize').get(() => Number.MAX_SAFE_INTEGER);
            const batchSize = service.chooseBatchSize(maxGranules);
            stubEnv.restore();
            const maxResults = opMaxResults || Number.MAX_SAFE_INTEGER;
            return batchSize === Math.min(cBatchSizeNorm, maxGranules, maxResults);
          },
        ),
      );
    });
  });

  describe('choosePageSize', function () {
    it('Should choose the minimum of the maxGranuleLimit, env.cmrMaxPageSize, operation maxResults', function () {
      fc.assert(
        fc.property(
          fc.integer(1, Number.MAX_SAFE_INTEGER),
          fc.option(fc.integer(1, Number.MAX_SAFE_INTEGER)),
          fc.integer(0, Number.MAX_SAFE_INTEGER),
          (pMaxGranules, pOpMaxResults, pEnvPageSize) => {
            const [
              maxGranules,
              opMaxResults,
              envPageSize,
            ] = [pMaxGranules, pOpMaxResults, pEnvPageSize].map((p) => p && p.valueOf());
            const config: ServiceConfig<ArgoServiceParams> = {};
            const op = {
              maxResults: opMaxResults,
            } as DataOperation;
            const service = new ArgoService(config, op);
            const stubEnv = stub(env, 'cmrMaxPageSize').get(() => envPageSize);
            const pageSize = service.choosePageSize(maxGranules);
            stubEnv.restore();
            const maxResults = opMaxResults || Number.MAX_SAFE_INTEGER;
            return pageSize === Math.min(envPageSize, maxGranules, maxResults);
          },
        ),
      );
    });
  });
});
