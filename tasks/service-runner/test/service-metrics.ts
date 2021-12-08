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
   describe('on start', async function () {

    describe('when the service is query-cmr', async function () {
      it('primes the CMR service', async function () {
        const harmonyService = 'harmonyservices/query-cmr:latest';
        env.harmonyService = harmonyService;
        const mock = new MockAdapter(axios);
        const expected_message = `# HELP ready_work_items_count Ready work items count for a harmony task-runner service.
# TYPE ready_work_items_count gauge
ready_work_items_count{service_id="${harmonyService}"} 0`;
        mock.onGet().reply(200, expected_message);
        _getHarmonyMetric();
        mock.restore();
      });
    });
  });
});
