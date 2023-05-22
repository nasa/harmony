import { expect } from 'chai';
import { hookGetCollectionCapabilities } from './helpers/capabilities';
import hookServersStartStop from './helpers/servers';

describe('Testing collection capabilities', function () {
  hookServersStartStop();
  describe('requesting JSON format', function () {
    const tests = [{
      description: 'with a valid collectionId configured for harmony',
      query: { collectionId: 'C1234088182-EEDTEST' },
    }, {
      description: 'with a valid shortName configured for harmony',
      query: { shortName: 'harmony_example' },
    }];
    for (const test of tests) {
      describe(test.description, function () {
        hookGetCollectionCapabilities(test.query);
        it('returns a 200 success status code', function () {
          expect(this.res.status).to.equal(200);
        });

        it('includes all of the expected fields in the response according to the default version', function () {
          const expectedFields = [
            'conceptId', 'shortName', 'variableSubset', 'bboxSubset', 'shapeSubset',
            'concatenate', 'reproject', 'outputFormats', 'services', 'variables',
          ];
          const capabilities = JSON.parse(this.res.text);
          expect(Object.keys(capabilities)).to.eql(expectedFields);
        });

        it('sets the conceptId field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.conceptId).to.equal('C1234088182-EEDTEST');
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
          expect(capabilities.shapeSubset).to.equal(true);
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
            'application/x-netcdf4', 'image/tiff', 'image/png', 'image/gif', 'application/x-zarr',
          ];
          expect(capabilities.outputFormats).to.eql(expectedFormats);
        });

        it('includes the correct services', function () {
          const capabilities = JSON.parse(this.res.text);
          const serviceNames = capabilities.services.map((s) => s.name);
          const expectedServices = ['nasa/harmony-gdal-adapter', 'harmony/netcdf-to-zarr', 'harmony/service-example'];
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
      it('returns a 404 status code', function () {
        expect(this.res.status).to.equal(404);
      });

      it('returns an error message indicating the collection could not be found', function () {
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.NotFoundError',
          description: 'Error: C0000-EEDTEST must be a CMR collection identifier, but we could not find a matching collection. Please make sure the collection ID is correct and that you have access to it.',
        });
      });
    });

    describe('with a shortName that does not exist in CMR', function () {
      hookGetCollectionCapabilities({ shortName: 'YouCallThatAShortName?' });
      it('returns a 404 status code', function () {
        expect(this.res.status).to.equal(404);
      });

      it('returns an error message indicating the collection could not be found', function () {
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.NotFoundError',
          description: 'Error: Unable to find collection short name YouCallThatAShortName? in the CMR. Please  make sure the short name is correct and that you have access to the collection.',
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
          description: 'Error: Must specify either collectionId or shortName',
        });
      });
    });

    describe('specifying both a collectionId and shortName', function () {
      hookGetCollectionCapabilities({ collectionId: 'C1234088182-EEDTEST', shortName: 'harmony_example' });
      it('returns a 400 status code', function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns an error message indicating the collection could not be found', function () {
        expect(JSON.parse(this.res.text)).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: Must specify only one of collectionId or shortName, not both',
        });
      });
    });

    describe('specifying a version parameter', function () {
      describe('specifying version 1', function () {
        hookGetCollectionCapabilities({ collectionId: 'C1234088182-EEDTEST', version: 1 });
        it('returns a 200 success status code', function () {
          expect(this.res.status).to.equal(200);
        });

        it('includes all of the expected fields in the version 1 response', function () {
          const expectedFields = [
            'conceptId', 'shortName', 'variableSubset', 'bboxSubset', 'shapeSubset',
            'concatenate', 'reproject', 'outputFormats', 'services', 'variables',
          ];
          const capabilities = JSON.parse(this.res.text);
          expect(Object.keys(capabilities)).to.eql(expectedFields);
        });
      });

      describe('specifying a version that does not exist', function () {
        hookGetCollectionCapabilities({ collectionId: 'C1234088182-EEDTEST', version: 'bad_version' });
        it('returns a 400 status code', function () {
          expect(this.res.status).to.equal(400);
        });

        it('returns an error message indicating the version was invalid', function () {
          expect(JSON.parse(this.res.text)).to.eql({
            code: 'harmony.RequestValidationError',
            description: 'Error: Invalid API version bad_version, supported versions: 1',
          });
        });
      });
    });
  });
});