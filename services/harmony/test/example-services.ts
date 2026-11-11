import { expect } from 'chai';
import { after, before, describe, it } from 'mocha';
import request from 'supertest';

import * as harmony from '../app/server';

describe('Example HTTP backend routes', function () {
  for (const value of ['true', 'false', '0', '1', 'TRUE', '', undefined]) {
    describe(`when EXAMPLE_SERVICES is ${JSON.stringify(value)}`, function () {
      before(async function () {
        this.servers = await harmony.start({
          EXAMPLE_SERVICES: value,
          USE_EDL_CLIENT_APP: 'false',
          PORT: '0',
          BACKEND_PORT: '0',
        });
      });

      after(async function () {
        await harmony.stop(this.servers);
      });

      const isMounted = value === 'true';
      it(`${isMounted ? 'mounts' : 'does not mount'} the /example routes`, async function () {
        const res = await request(this.servers.frontend).get('/example/status').query({ id: 'foo' });
        if (isMounted) {
          expect(res.text).to.include('no callback found for id="foo"');
        } else {
          expect(res.text).to.not.include('no callback found');
        }
      });
    });
  }
});
