import { expect } from 'chai';
import { hookGetCollectionCapabilities } from './helpers/capabilities';
import hookServersStartStop from './helpers/servers';

describe('Testing collection capabilities', function () {
  hookServersStartStop();
  describe('requesting JSON format', function () {
    const tests = [{
      description: 'with a valid collectionId configured for harmony',
      query: { collectionId: 'C1233800302-EEDTEST' },
    }, {
      description: 'with a valid shortName configured for harmony',
      query: { collectionId: 'harmony_example' },
    }];
    for (const test of tests) {
      describe(test.description, function () {
        hookGetCollectionCapabilities(test.query);
        it('returns a 200 success status code', function () {
          expect(this.res.status).to.equal(200);
        });

        it('includes all of the expected fields in the response', function () {
          const expectedFields = [
            'conceptId', 'shortName', 'variableSubset', 'bboxSubset', 'shapeSubset',
            'concatenate', 'reproject', 'outputFormats', 'services', 'variables',
          ];
          const capabilities = JSON.parse(this.res.text);
          expect(Object.keys(capabilities)).to.eql(expectedFields);
        });

        it('sets the conceptId field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.conceptId).to.equal('C1233800302-EEDTEST');
        });

        it('sets the shortName field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.shortName).to.equal('harmony_example');
        });

        it('sets the variableSubset field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.variableSubset).to.equal(true);
        });

        it('sets the bboxSubset field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.bboxSubset).to.equal(true);
        });

        it('sets the shapeSubset field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.shapeSubset).to.equal(false);
        });

        it('sets the concatenate field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.concatenate).to.equal(true);
        });

        it('sets the reproject field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.reproject).to.equal(true);
        });

        it('sets the outputFormats field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedFormats = [
            'image/tiff', 'image/png', 'image/gif', 'application/netcdf',
            'application/x-netcdf4', 'application/x-zarr',
          ];
          expect(capabilities.outputFormats).to.eql(expectedFormats);
        });

        it('includes the correct services', function () {
          const capabilities = JSON.parse(this.res.text);
          const serviceNames = capabilities.services.map((s) => s.name);
          const expectedServices = ['harmony/service-example', 'harmony/swot-repr-netcdf-to-zarr'];
          expect(serviceNames).to.eql(expectedServices);
        });

        it('sets the variables field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedVariables = ['alpha_var', 'blue_var', 'green_var', 'red_var'];
          expect(capabilities.variables).to.eql(expectedVariables);
        });
      });
    }

    describe('with a collectionId that does not exist in CMR', function () {
      hookGetCollectionCapabilities({ collectionId: 'C0000-EEDTEST' });
      it('returns a 400 status code', function () {
        expect(this.res.status).to.equal(400);
      });
      it('returns an error message indicating the collection could not be found', function () {
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: C0000-EEDTEST must be a CMR collection identifier, but we could not find a matching collection. Please make sure the collection IDis correct and that you have access to it.',
        });
      });
    });

    describe('without specifying a collectionId or shortName', function () {
      hookGetCollectionCapabilities();
      it('returns a 400 status code', function () {
        expect(this.res.status).to.equal(400);
      });
      it('returns an error message indicating the collection could not be found', function () {
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Missing required parameter collectionId',
        });
      });
    });
  });
});