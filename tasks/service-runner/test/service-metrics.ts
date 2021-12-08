import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import env from '../app/util/env';
import { exportedForTesting } from '../app/service/service-metrics';

import request from 'supertest';

const { _getHarmonyMetric } = exportedForTesting;



describe('Service Metrics', async function () {

  let mock;
  before(function () {
    mock = new MockAdapter(axios);
  });

  it('Get 200 response', async function () {
    const harmonyService = 'harmonyservices/query-cmr:latest';
    env.harmonyService = harmonyService;
    const harmony_metric = `# HELP ready_work_items_count Ready work items count for a harmony task-runner service.
# TYPE ready_work_items_count gauge
ready_work_items_count{service_id="${harmonyService}"} 0`;
    mock.onGet().reply(200, {availableWorkItems: 0});
    const res = await _getHarmonyMetric();
    expect(res).to.equal(harmony_metric);
  });

  afterEach(function () {
    mock.restore();
  });

});
