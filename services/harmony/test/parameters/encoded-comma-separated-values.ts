import { expect } from 'chai';
import { describe, it } from 'mocha';
import request from 'supertest';

import { auth } from '../helpers/auth';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';

// Job status pages link to the original request URL, in which commas are URL-encoded
// as %2C. These requests are sent as raw URLs so the encoding is exactly what a user
// clicking that link would send.
describe('Comma-separated parameter values', function () {
  const collection = 'C1233800302-EEDTEST';
  const granuleIds = ['G1233800352-EEDTEST', 'G1233800343-EEDTEST'];
  const encodedGranuleIds = granuleIds.join('%2C');

  hookServersStartStop();

  const requests = {
    'OGC API Coverages': `/${collection}/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?granuleId=${encodedGranuleIds}`,
    'OGC API EDR': `/ogc-api-edr/1.1.0/collections/${collection}/cube?bbox=-180,-90,180,90&granuleId=${encodedGranuleIds}`,
    'WMS': `/${collection}/wms?service=WMS&request=GetMap&layers=${collection}&crs=EPSG:4326&format=image/tiff&styles=&width=128&height=128&version=1.3.0&bbox=-180,-90,180,90&transparent=TRUE&granuleId=${encodedGranuleIds}`,
  };

  for (const [frontend, url] of Object.entries(requests)) {
    describe(`for ${frontend} granuleIds separated by an encoded comma`, function () {
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

      it('splits the granuleId value into separate granule IDs', function () {
        expect(this.service.operation.granuleIds).to.eql(granuleIds);
      });
    });
  }

  describe('for variables', function () {
    const granuleId = granuleIds[0];
    const variableIds = ['V1233801695-EEDTEST', 'V1233801696-EEDTEST'];
    const coveragesPath = `/${collection}/ogc-api-coverages/1.0.0/collections`;
    const edrPath = `/ogc-api-edr/1.1.0/collections/${collection}/cube?bbox=-180,-90,180,90&granuleId=${granuleId}`;

    const variableRequests = {};
    for (const [separatorName, separator] of [['a comma', ','], ['an encoded comma', '%2C']]) {
      variableRequests[`OGC API Coverages variables in the path separated by ${separatorName}`] =
        `${coveragesPath}/red_var${separator}${variableIds[1]}/coverage/rangeset?granuleId=${granuleId}`;
      variableRequests[`OGC API Coverages parameter_vars with the variable parameter separated by ${separatorName}`] =
        `${coveragesPath}/parameter_vars/coverage/rangeset?granuleId=${granuleId}&variable=red_var${separator}${variableIds[1]}`;
      variableRequests[`OGC API EDR parameter-name separated by ${separatorName}`] =
        `${edrPath}&parameter-name=red_var${separator}${variableIds[1]}`;
    }

    for (const [description, url] of Object.entries(variableRequests)) {
      describe(description, function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        before(async function () {
          this.res = await request(this.frontend).get(url as string).use(auth({ username: 'joe' }));
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
});
