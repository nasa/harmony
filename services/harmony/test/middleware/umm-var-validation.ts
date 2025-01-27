import { expect } from 'chai';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import { hookServices } from '../helpers/stub-service';

const collectionId = 'C1233800302-EEDTEST';
const invalidVariable = 'does-not-exist-in-cmr';

describe('UMM variable validation', function () {
  describe('for a service that validates against CMR variables', function () {
    hookServersStartStop();
    const serviceConfigs = [
      {
        name: 'test-variable-validation-on',
        data_operation_version: '0.20.0',
        type: {
          name: 'turbo',
        },
        collections: [{ id: collectionId }],
        capabilities: {
          subsetting: {
            variable: true,
          },
        },
        validate_variables: true,
        steps: [{
          image: 'foo',
          is_sequential: true,
        }],
      },
    ];
    hookServices(serviceConfigs);

    describe('when submitting a request for a variable that does not exist in CMR', function () {
      hookRangesetRequest('1.0.0', collectionId, invalidVariable, { query: {}, username: 'joe' });

      it('rejects the request', function () {
        expect(this.res.status).to.equal(400);
      });

      it('provides an appropriate error message', function () {
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Coverages were not found for the provided variables: does-not-exist-in-cmr',
        });
      });
    });
  });

  describe('for a service that skips validation against the CMR', function () {
    hookServersStartStop();
    const serviceConfigs = [
      {
        name: 'test-variable-validation-disabled',
        data_operation_version: '0.20.0',
        type: {
          name: 'turbo',
        },
        collections: [{ id: collectionId }],
        capabilities: {
          subsetting: {
            variable: true,
          },
        },
        validate_variables: false,
        steps: [{
          image: 'foo',
          is_sequential: true,
        }],
      },
    ];
    hookServices(serviceConfigs);

    describe('when submitting a request for a variable that does not exist in CMR', function () {
      hookRangesetRequest('1.0.0', collectionId, invalidVariable, { query: {}, username: 'joe' });

      it('accepts the request', function () {
        expect(this.res.status).to.equal(303);
      });
    });
  });
});