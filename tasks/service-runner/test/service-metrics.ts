import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import env from '../app/util/env';
import { exportedForTesting } from '../app/service/service-metrics';
import request from 'supertest';

describe('Service Metrics', async function () {

  let mock;
  const { _getHarmonyMetric } = exportedForTesting;
  before(function () {
    mock = new MockAdapter(axios);
  });

  describe('when prometheus pulls the metric', async function () {
    const serviceID = 'harmonyservices/query-cmr:latest';
    before(function () {
      env.harmonyService = serviceID;
    });

    it('runs successfully', async function () {
      const harmony_metric = `# HELP ready_work_items_count Ready work items count for a harmony task-runner service.
# TYPE ready_work_items_count gauge
ready_work_items_count{service_id="${serviceID}"} 0`;
      mock.onGet().reply(200, {availableWorkItems: 0});
      const res = await _getHarmonyMetric(serviceID);
      expect(res).to.equal(harmony_metric);
    });

  /*
    it('Get error response', async function () {
      const serviceID = 'harmonyservices/query-cmr:latest';
      mock.onGet().reply(500);
      const res = await _getHarmonyMetric();
      expect(_getHarmonyMetric).to.throw();
    });
  */
    afterEach(function () {
      mock.restore();
      });
  });

});
