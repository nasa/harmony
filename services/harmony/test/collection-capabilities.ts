import { expect } from 'chai';
import _ from 'lodash';

import { stableApiVersion } from '../app/frontends/capabilities';
import { hookGetCollectionCapabilities } from './helpers/capabilities';
import hookServersStartStop from './helpers/servers';

// This is the concept ID of the most recently updated collection with a
// short name of "harmony_example". There are 3 collections with the same
// short name, so if either of the other two are updated these tests will no
// longer pass when regenerating CMR test fixtures.
const collectionId = 'C1234088182-EEDTEST';

describe('Testing collection capabilities', function () {
  hookServersStartStop();
  describe('requesting JSON format', function () {
    const tests = [{
      description: 'with a valid collectionId configured for harmony',
      query: { collectionId },
    }, {
      description: 'with a valid shortName configured for harmony',
      query: { shortName: 'harmony_example' },
    }, {
      description: 'with a valid collectionId configured for harmony and stable version',
      query: { collectionId, version: stableApiVersion },
    }, {
      description: 'with a valid shortName configured for harmony and stable version',
      query: { shortName: 'harmony_example', version: stableApiVersion },
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
            'temporalSubset', 'concatenate', 'reproject', 'outputFormats', 'services',
            'variables', 'capabilitiesVersion',
          ];
          const capabilities = JSON.parse(this.res.text);
          expect(Object.keys(capabilities)).to.eql(expectedFields);
        });

        it('sets the conceptId field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.conceptId).to.equal(collectionId);
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

        it('sets the temporalSubset field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.temporalSubset).to.equal(false);
        });

        it('sets the concatenate field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.concatenate).to.equal(false);
        });

        it('sets the reproject field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.reproject).to.equal(true);
        });

        it('sets the outputFormats field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedFormats = [
            'application/netcdf', 'image/tiff', 'image/png', 'image/gif',
          ];
          expect(capabilities.outputFormats).to.eql(expectedFormats);
        });

        it('includes the correct services', function () {
          const capabilities = JSON.parse(this.res.text);
          const services_name_href = capabilities.services.map((s) => _.pick(s, ['name', 'href']));
          const expectedServices = [{
            'name': 'sds/swath-projector',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/S1237974711-EEDTEST',
          },
          {
            'name': 'harmony/service-example',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/S1257851197-EEDTEST',
          }];
          expect(services_name_href).to.eql(expectedServices);
        });

        it('sets the variables field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedVariables = [{
            'name': 'alpha_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088190-EEDTEST',
          },
          {
            'name': 'blue_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088189-EEDTEST',
          },
          {
            'name': 'green_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088188-EEDTEST',
          },
          {
            'name': 'red_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088187-EEDTEST',
          }];
          expect(capabilities.variables).to.eql(expectedVariables);
        });

        it('includes the correct capabilitiesVersion', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.capabilitiesVersion).to.equal(stableApiVersion);
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
          description: 'Error: Unable to find collection short name YouCallThatAShortName? in the CMR. Please make sure the short name is correct and that you have access to the collection.',
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
      hookGetCollectionCapabilities({ collectionId, shortName: 'harmony_example' });
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
            'conceptId', 'shortName', 'variableSubset', 'bboxSubset', 'shapeSubset', 'temporalSubset',
            'concatenate', 'reproject', 'outputFormats', 'services', 'variables', 'capabilitiesVersion',
          ];
          const capabilities = JSON.parse(this.res.text);
          expect(Object.keys(capabilities)).to.eql(expectedFields);
        });

        it('sets the conceptId field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.conceptId).to.equal('C1234088182-EEDTEST');
        });

        it('sets the shortName field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.shortName).to.equal('harmony_example');
        });

        it('sets the variableSubset field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.variableSubset).to.equal(true);
        });

        it('sets the bboxSubset field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.bboxSubset).to.equal(true);
        });

        it('sets the shapeSubset field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.shapeSubset).to.equal(false);
        });

        it('sets the temporalSubset field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.temporalSubset).to.equal(false);
        });

        it('sets the concatenate field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.concatenate).to.equal(false);
        });

        it('sets the reproject field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.reproject).to.equal(true);
        });

        it('sets the outputFormats field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedFormats = [
            'application/netcdf', 'image/tiff', 'image/png', 'image/gif',
          ];
          expect(capabilities.outputFormats).to.eql(expectedFormats);
        });

        it('includes the correct services in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          const serviceNames = capabilities.services.map((s) => s.name);
          const expectedServices = ['sds/swath-projector', 'harmony/service-example'];
          expect(serviceNames).to.eql(expectedServices);
        });

        it('sets the variables field correctly in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedVariables = ['alpha_var', 'blue_var', 'green_var', 'red_var'];
          expect(capabilities.variables).to.eql(expectedVariables);
        });

        it('includes the correct capabilitiesVersion in the version 1 response', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.capabilitiesVersion).to.equal('1');
        });
      });

      describe('specifying version 2', function () {
        hookGetCollectionCapabilities({ collectionId: 'C1234088182-EEDTEST', version: 2 });
        it('returns a 200 success status code', function () {
          expect(this.res.status).to.equal(200);
        });

        it('includes all of the expected fields in the response according to the default version', function () {
          const expectedFields = [
            'conceptId', 'shortName', 'variableSubset', 'bboxSubset', 'shapeSubset',
            'temporalSubset', 'concatenate', 'reproject', 'outputFormats', 'services',
            'variables', 'capabilitiesVersion',
          ];
          const capabilities = JSON.parse(this.res.text);
          expect(Object.keys(capabilities)).to.eql(expectedFields);
        });

        it('sets the conceptId field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.conceptId).to.equal(collectionId);
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

        it('sets the temporalSubset field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.temporalSubset).to.equal(false);
        });

        it('sets the concatenate field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.concatenate).to.equal(false);
        });

        it('sets the reproject field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.reproject).to.equal(true);
        });

        it('sets the outputFormats field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedFormats = [
            'application/netcdf', 'image/tiff', 'image/png', 'image/gif',
          ];
          expect(capabilities.outputFormats).to.eql(expectedFormats);
        });

        it('includes the correct services', function () {
          const capabilities = JSON.parse(this.res.text);
          const services_name_href = capabilities.services.map((s) => _.pick(s, ['name', 'href']));
          const expectedServices = [{
            'name': 'sds/swath-projector',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/S1237974711-EEDTEST',
          },
          {
            'name': 'harmony/service-example',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/S1257851197-EEDTEST',
          }];
          expect(services_name_href).to.eql(expectedServices);
        });

        it('sets the variables field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedVariables = [{
            'name': 'alpha_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088190-EEDTEST',
          },
          {
            'name': 'blue_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088189-EEDTEST',
          },
          {
            'name': 'green_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088188-EEDTEST',
          },
          {
            'name': 'red_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088187-EEDTEST',
          }];
          expect(capabilities.variables).to.eql(expectedVariables);
        });

        it('includes the correct capabilitiesVersion', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.capabilitiesVersion).to.equal('2');
        });
      });

      describe('specifying version 3', function () {
        hookGetCollectionCapabilities({ collectionId: 'C1234088182-EEDTEST', version: 3 });
        it('returns a 200 success status code', function () {
          expect(this.res.status).to.equal(200);
        });

        it('includes all of the expected fields in the response according to version 3', function () {
          const expectedFields = [
            'conceptId', 'shortName', 'summary', 'services', 'variables', 'capabilitiesVersion',
          ];
          const capabilities = JSON.parse(this.res.text);
          expect(Object.keys(capabilities)).to.eql(expectedFields);
        });

        it('sets the conceptId field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.conceptId).to.equal(collectionId);
        });

        it('sets the shortName field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.shortName).to.equal('harmony_example');
        });

        it('sets the summary.subsetting field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const actualSubsetting = capabilities.summary.subsetting;

          expect(actualSubsetting.bbox).to.be.true;
          expect(actualSubsetting.dimension).to.be.false;
          expect(actualSubsetting.shape).to.be.false;
          expect(actualSubsetting.temporal).to.be.false;
          expect(actualSubsetting.variable).to.be.true;
        });

        it('sets the summary.concatenation field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.summary.concatenation).to.equal(false);
        });

        it('sets the summary.reprojection field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const actualReprojection = capabilities.summary.reprojection;

          const expectedProjections = [{
            name: 'Geographic',
            crs: 'EPSG:4326',
          }];

          const expectedInterpolationMethods = ['Bilinear Interpolation', 'Nearest Neighbor'];

          expect(actualReprojection.supported).to.be.true;
          expect(actualReprojection.supportedProjections).to.eql(expectedProjections);
          expect(actualReprojection.interpolationMethods).to.eql(expectedInterpolationMethods);

        });

        it('sets the summary.outputFormats field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedFormats = [
            {
              'mimeType': 'image/tiff',
              'name': 'GEOTIFF',
            },
            {
              'mimeType': 'image/gif',
              'name': 'GIF',
            },
            {
              'mimeType': 'application/netcdf',
              'name': 'NETCDF-4',
            },
            {
              'mimeType': 'image/png',
              'name': 'PNG',
            },
          ];
          expect(capabilities.summary.outputFormats).to.eql(expectedFormats);
        });

        it('includes the correct services', function () {
          const capabilities = JSON.parse(this.res.text);
          const services_name_href = capabilities.services.map((s) => _.pick(s, ['name', 'href']));
          const expectedServices = [{
            'name': 'sds/swath-projector',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/S1237974711-EEDTEST',
          },
          {
            'name': 'harmony/service-example',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/S1257851197-EEDTEST',
          }];
          expect(services_name_href).to.eql(expectedServices);
        });

        it('includes the supported reprojections within the services', function () {
          const capabilities = JSON.parse(this.res.text);
          const { supportedProjections } = capabilities.services[0].capabilities.reprojection;
          const expectedProjections = [{
            'name': 'Geographic',
            'crs': 'EPSG:4326',
          }];
          expect(supportedProjections).to.eql(expectedProjections);
        });

        it('includes the interpolation methods within the services', function () {
          const capabilities = JSON.parse(this.res.text);
          const { interpolationMethods } = capabilities.services[0].capabilities.reprojection;
          const expectedInterpolationMethods = ['Bilinear Interpolation', 'Nearest Neighbor'];

          expect(interpolationMethods).to.eql(expectedInterpolationMethods);
        });

        it('includes the complete v3 capability schema for every service', function () {
          const capabilities = JSON.parse(this.res.text);

          for (const service of capabilities.services) {
            expect(Object.keys(service.capabilities)).to.include.members([
              'subsetting',
              'concatenation',
              'reprojection',
              'averaging',
              'outputFormats',
            ]);
            expect(Object.keys(service.capabilities.subsetting)).to.include.members([
              'bbox',
              'dimension',
              'shape',
              'temporal',
              'variable',
            ]);
            expect(Object.keys(service.capabilities.averaging)).to.include.members([
              'time',
              'area',
            ]);
          }
        });

        it('sets the variables field correctly', function () {
          const capabilities = JSON.parse(this.res.text);
          const expectedVariables = [{
            'name': 'alpha_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088190-EEDTEST',
          },
          {
            'name': 'blue_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088189-EEDTEST',
          },
          {
            'name': 'green_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088188-EEDTEST',
          },
          {
            'name': 'red_var',
            'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/V1234088187-EEDTEST',
          }];
          expect(capabilities.variables).to.eql(expectedVariables);
        });

        it('includes the correct capabilitiesVersion', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.capabilitiesVersion).to.equal('3-alpha');
        });
      });

      describe('specifying version 3-alpha', function () {
        hookGetCollectionCapabilities({ collectionId: 'C1234088182-EEDTEST', version: '3-alpha' });
        it('returns a 200 success status code', function () {
          expect(this.res.status).to.equal(200);
        });

        it('includes all of the expected fields in the response according to version 3', function () {
          const expectedFields = [
            'conceptId', 'shortName', 'summary', 'services', 'variables', 'capabilitiesVersion',
          ];
          const capabilities = JSON.parse(this.res.text);
          expect(Object.keys(capabilities)).to.eql(expectedFields);
        });

        it('includes the correct capabilitiesVersion', function () {
          const capabilities = JSON.parse(this.res.text);
          expect(capabilities.capabilitiesVersion).to.equal('3-alpha');
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
            description: 'Error: Invalid API version bad_version, supported versions: 1, 2, and 3-alpha',
          });
        });
      });
    });
  });
});
