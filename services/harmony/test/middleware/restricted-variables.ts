import { expect } from 'chai';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import { hookServices } from '../helpers/stub-service';

const collectionId = 'C1233800302-EEDTEST';
const supportedVariable = 'V1233801695-EEDTEST';
const unsupportedVariable = 'V1233801696-EEDTEST';

describe('testing variables configured directly in services.yml', function () {
  hookServersStartStop();
  const serviceConfigs = [
    {
      name: 'test-variables',
      data_operation_version: '0.20.0',
      type: {
        name: 'turbo',
      },
      collections: [{ id: collectionId, variables: [supportedVariable] }],
      capabilities: {
        subsetting: {
          variable: true,
        },
      },
      steps: [{
        image: 'foo',
        is_sequential: true,
      }],
    },
  ];
  hookServices(serviceConfigs);
  describe('when submitting a request for a supported variable', function () {
    hookRangesetRequest('1.0.0', collectionId, supportedVariable, { query: {}, username: 'joe' });
    it('accepts the request', function () {
      expect(this.res.status).to.equal(303);
    });
  });

  describe('when submitting a request for a supported variable', function () {
    hookRangesetRequest('1.0.0', collectionId, unsupportedVariable, { query: {}, username: 'joe' });

    it('rejects the request', function () {
      expect(this.res.status).to.equal(400);
    });

    it('provides an appropriate error message', function () {
      expect(JSON.parse(this.res.text)).to.eql({
        code: 'harmony.RequestValidationError',
        description: 'Error: Not all variables selected can be subset',
      });
    });
  });
});

