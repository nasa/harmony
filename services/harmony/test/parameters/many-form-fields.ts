import { expect } from 'chai';
import { describe, it } from 'mocha';
import request, { Test } from 'supertest';

import env from '../../app/util/env';
import { auth } from '../helpers/auth';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';

// Multipart form POSTs are limited to env.maxPostFields fields and env.maxPostFileParts parts.
// Exceeding either limit used to return a 500 Internal server error.
describe('OGC API Coverages POST with more form fields than the limit', function () {
  const collection = 'C1233800302-EEDTEST';
  const granuleId = 'G1233800352-EEDTEST';
  const variableNames = ['red_var', 'green_var', 'blue_var', 'alpha_var'];
  const variableIds = ['V1233801695-EEDTEST', 'V1233801696-EEDTEST', 'V1233801716-EEDTEST', 'V1233801717-EEDTEST'];
  const coveragesPath = `/${collection}/ogc-api-coverages/1.0.0/collections/parameter_vars/coverage/rangeset`;
  // The variables are repeated to get past the limit without needing a collection with that
  // many variables. Duplicate variables are only passed to the backend service once.
  const numVariables = Math.max(env.maxPostFields, env.maxPostFileParts) + 50;
  const manyVariables = Array.from({ length: numVariables }, (_, i) => variableNames[i % variableNames.length]);

  hookServersStartStop();

  describe('when each variable is sent as a separate form field', function () {
    before(async function () {
      let req: Test = request(this.frontend).post(coveragesPath).field('granuleId', granuleId);
      for (const variable of manyVariables) {
        req = req.field('variable', variable);
      }
      this.res = await req.use(auth({ username: 'joe' }));
    });
    after(function () {
      delete this.res;
    });

    it('returns a 400 error', function () {
      expect(this.res.status).to.equal(400);
    });

    it('returns a RequestValidationError explaining how to send many values', function () {
      const { code, description } = JSON.parse(this.res.text);
      expect(code).to.equal('harmony.RequestValidationError');
      expect(description).to.match(/^Error: Too many form (fields|parts)\. Harmony accepts at most \d+ /);
      expect(description).to.include('send them as a single comma-separated value');
    });
  });

  describe('when the variables are sent as a single comma-separated form field', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    before(async function () {
      this.res = await request(this.frontend)
        .post(coveragesPath)
        .field('granuleId', granuleId)
        .field('variable', manyVariables.join(','))
        .use(auth({ username: 'joe' }));
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
});
