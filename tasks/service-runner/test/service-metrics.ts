import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import env from '../app/util/env';
import { exportedForTesting } from '../app/service/service-metrics';

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

    describe('and harmony returns a valid metric', async function () {
      it('returns a valid metric string', async function () {
        mock.onGet().reply(200, { availableWorkItems: 0 });
        const res = await _getHarmonyMetric(serviceID);
        const expected_harmony_metric = `# HELP ready_work_items_count Ready work items count for a harmony task-runner service.
# TYPE ready_work_items_count gauge
ready_work_items_count{service_id="${serviceID}"} 0`;
        expect(res).to.equal(expected_harmony_metric);
      });
    });

    describe('and harmony returns an error', async function () {
      it('throws an error', async function () {
        mock.onGet().reply(500);
        expect(function (){
          _getHarmonyMetric(serviceID);
        }).to.throw;
      });
    });
  });

  after(function () {
    mock.restore();
  });
});
