import { expect } from 'chai';
import { describe, it } from 'mocha';
import request from 'supertest';

import { auth } from '../helpers/auth';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';

// By default qs stops parsing a parameter as an array once it has more than 20 values,
// which used to cause these requests to fail with a 500 error
describe('Query parameters with more than 20 values', function () {
  const collection = 'C1233800302-EEDTEST';
  const granuleId = 'G1233800352-EEDTEST';
  const variableNames = ['red_var', 'green_var', 'blue_var', 'alpha_var'];
  const variableIds = ['V1233801695-EEDTEST', 'V1233801696-EEDTEST', 'V1233801716-EEDTEST', 'V1233801717-EEDTEST'];
  // The variables are repeated to get past the limit without needing a collection with that
  // many variables. Duplicate variables are only passed to the backend service once.
  const manyVariables = Array.from({ length: 25 }, (_, i) => variableNames[i % variableNames.length]);

  hookServersStartStop();

  const coveragesPath = `/${collection}/ogc-api-coverages/1.0.0/collections/parameter_vars/coverage/rangeset?granuleId=${granuleId}`;
  const edrPath = `/ogc-api-edr/1.1.0/collections/${collection}/cube?bbox=-180,-90,180,90&granuleId=${granuleId}`;

  const requests = {
    'OGC API Coverages with a repeated variable parameter':
      `${coveragesPath}&${manyVariables.map((v) => `variable=${v}`).join('&')}`,
    'OGC API Coverages with a comma-separated variable parameter':
      `${coveragesPath}&variable=${manyVariables.join(',')}`,
    'OGC API EDR with a repeated parameter-name parameter':
      `${edrPath}&${manyVariables.map((v) => `parameter-name=${v}`).join('&')}`,
    'OGC API EDR with a comma-separated parameter-name parameter':
      `${edrPath}&parameter-name=${manyVariables.join(',')}`,
  };

  for (const [description, url] of Object.entries(requests)) {
    describe(description, function () {
      StubService.hook({ params: { redirect: 'http://example.com' } });
      before(async function () {
        this.res = await request(this.frontend).get(url).use(auth({ username: 'joe' }));
      });
      after(function () {
        delete this.res;
      });

      it('accepts the request', function () {
        expect(this.res.status).to.be.oneOf([200, 303]);
      });

      it('passes each variable to the backend service', function () {
        const { variables } = this.service.operation.sources[0];
        expect(variables.map((v) => v.id)).to.eql(variableIds);
      });
    });
  }
});
