import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { stub } from 'sinon';
import { getMaxSynchronousGranules, getMaxAsynchronousGranules } from 'models/services/base-service';
import DataOperation from '../../app/models/data-operation';
import { chooseServiceConfig, buildService } from '../../app/models/services';
import env from '../../app/util/env';

describe('services.chooseServiceConfig and services.buildService', function () {
  describe("when the operation's collection is configured for two services", function () {
    beforeEach(function () {
      const collectionId = 'C123-TEST';
      const operation = new DataOperation();
      operation.addSource(collectionId);
      this.operation = operation;
      this.config = [
        {
          name: 'first-service',
          type: { name: 'argo' },
          collections: [collectionId],
          capabilities: {
            output_formats: ['image/tiff', 'application/x-netcdf4'],
            subsetting: {
              shape: true,
            },
          },
        },
        {
          name: 'second-service',
          type: { name: 'http' },
          collections: [collectionId],
          capabilities: {
            output_formats: ['image/tiff', 'image/png'],
            subsetting: {
              bbox: true,
            },
          },
        },
        {
          name: 'third-service',
          type: { name: 'argo' },
          collections: [collectionId],
          capabilities: {
            output_formats: ['image/tiff', 'image/png'],
            reprojection: true,
          },
        },
      ];
    });

    describe('and both can produce the requested output type', function () {
      beforeEach(function () {
        this.operation.outputFormat = 'image/tiff';
      });

      it('returns the first service for the collection from the service configuration', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('first-service');
      });

      it('uses the correct service class when building the service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        const service = buildService(serviceConfig, this.operation);
        expect(service.constructor.name).to.equal('ArgoService');
      });
    });

    describe('and only the second can produce the requested output type', function () {
      beforeEach(function () {
        this.operation.outputFormat = 'image/png';
      });

      it('returns the second service for the collection from the service configuration', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('second-service');
      });

      it('uses the correct service class when building the service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        const service = buildService(serviceConfig, this.operation);
        expect(service.constructor.name).to.equal('HttpService');
      });
    });

    describe('and neither can produce the requested output type', function () {
      beforeEach(function () {
        this.operation.outputFormat = 'image/gif';
      });

      it('returns the no-op service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('noOpService');
      });

      it('returns a message indicating that there were no services that could support the provided format', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.message).to.equal('the requested combination of operations: reformatting to image/gif on C123-TEST is unsupported');
      });

      it('provides a human readable message when building the service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        const service = buildService(serviceConfig, this.operation);
        expect(service.message).to.equal('Returning direct download links because the requested combination of operations: reformatting to image/gif on C123-TEST is unsupported.');
      });
    });

    describe('and the request needs spatial subsetting', function () {
      beforeEach(function () {
        this.operation.boundingRectangle = [0, 0, 10, 10];
      });

      it('chooses the service that supports spatial subsetting', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('second-service');
      });
    });

    describe('and the request needs both spatial subsetting and netcdf output, but no service supports that combination', function () {
      beforeEach(function () {
        this.operation.boundingRectangle = [0, 0, 10, 10];
        this.operation.outputFormat = 'application/x-netcdf4';
      });

      it('chooses the service that supports netcdf output, but not spatial subsetting', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('first-service');
      });

      it('indicates that it could not clip based on the spatial extent', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.message).to.equal('Data in output files may extend outside the spatial bounds you requested.');
      });
    });

    describe('and the request needs shapefile subsetting', function () {
      beforeEach(function () {
        this.operation.geojson = { pretend: 'geojson' };
      });

      it('chooses the service that supports shapefile subsetting', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('first-service');
      });
    });

    describe('and the request needs both shapefile subsetting and reprojection, but no service supports that combination', function () {
      beforeEach(function () {
        this.operation.geojson = { pretend: 'geojson' };
        this.operation.crs = 'EPSG:4326';
      });

      it('returns the service that supports reprojection, but not shapefile subsetting', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('third-service');
      });

      it('indicates that it could not clip based on the spatial extent', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.message).to.equal('Data in output files may extend outside the spatial bounds you requested.');
      });
    });

    describe('and the request needs reprojection', function () {
      beforeEach(function () {
        this.operation.crs = 'EPSG:4326';
      });

      it('chooses the service that supports reprojection', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('third-service');
      });
    });

    describe('and the request needs both reprojection and netcdf output, but no service supports that combination', function () {
      beforeEach(function () {
        this.operation.crs = 'EPSG:4326';
        this.operation.outputFormat = 'application/x-netcdf4';
      });

      it('returns the no-op service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('noOpService');
      });

      it('indicates the reason for choosing the no op service is the combination of reprojection and reformatting', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.message).to.equal('the requested combination of operations: reprojection and reformatting to application/x-netcdf4 on C123-TEST is unsupported');
      });
    });

    describe('and the request needs spatial subsetting, reprojection, and netcdf output, but no service supports that combination', function () {
      beforeEach(function () {
        this.operation.crs = 'EPSG:4326';
        this.operation.outputFormat = 'application/x-netcdf4';
        this.operation.boundingRectangle = [0, 0, 10, 10];
      });

      it('returns the no-op service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('noOpService');
      });

      it('indicates the reason for choosing the no op service is the combination of reprojection and reformatting', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.message).to.equal('the requested combination of operations: reprojection and reformatting to application/x-netcdf4 on C123-TEST is unsupported');
      });
    });
  });

  describe("when the operation's collection has a single configured service", function () {
    beforeEach(function () {
      const collectionId = 'C123-TEST';
      const operation = new DataOperation();
      operation.addSource(collectionId);
      this.operation = operation;
      this.config = [
        {
          name: 'non-matching-service',
          type: { name: 'argo' },
          collections: ['C456-NOMATCH'],
        },
        {
          name: 'matching-service',
          type: { name: 'argo' },
          collections: [collectionId],
        },
      ];
    });

    it('returns the service configured for the collection', function () {
      const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
      expect(serviceConfig.name).to.equal('matching-service');
    });

    it('uses the correct service class when building the service', function () {
      const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
      const service = buildService(serviceConfig, this.operation);
      expect(service.constructor.name).to.equal('ArgoService');
    });
  });

  describe('when one out of two services support variable subsetting', function () {
    const collectionId = 'C123-TEST';
    beforeEach(function () {
      this.config = [
        {
          name: 'variable-subsetter',
          type: { name: 'argo' },
          capabilities: {
            subsetting: { variable: true },
            output_formats: ['image/tiff'],
          },
          collections: [collectionId],
        },
        {
          name: 'non-variable-subsetter',
          type: { name: 'argo' },
          capabilities: {
            subsetting: { variable: false },
            output_formats: ['application/x-zarr'],
          },
          collections: [collectionId],
        },
      ];
    });

    describe('requesting variable subsetting with an output format available on the variable subsetter service', function () {
      const operation = new DataOperation();
      operation.addSource(collectionId, [{ meta: { 'concept-id': 'V123-PROV1' }, umm: { Name: 'the-var' } }]);
      operation.outputFormat = 'image/tiff';

      it('returns the service configured for variable subsetting', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        expect(serviceConfig.name).to.equal('variable-subsetter');
      });

      it('uses the correct service class when building the service', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        const service = buildService(serviceConfig, operation);
        expect(service.constructor.name).to.equal('ArgoService');
      });
    });

    describe('requesting variable subsetting with an output format that is not supported by the variable subsetting service, but is supported by other services', function () {
      const operation = new DataOperation();
      operation.addSource(collectionId, [{ meta: { 'concept-id': 'V123-PROV1' }, umm: { Name: 'the-var' } }]);
      operation.outputFormat = 'application/x-zarr';

      it('returns the no op service', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        expect(serviceConfig.name).to.equal('noOpService');
      });

      it('uses the correct service class when building the service', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        const service = buildService(serviceConfig, operation);
        expect(service.constructor.name).to.equal('NoOpService');
      });

      it('indicates the reason for choosing the no op service is the combination of variable subsetting and the output format', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        expect(serviceConfig.message).to.equal('the requested combination of operations: variable subsetting and reformatting to application/x-zarr on C123-TEST is unsupported');
      });
    });

    describe('requesting no variable subsetting and a format supported by the service that does not support variable subsetting', function () {
      const operation = new DataOperation();
      operation.addSource(collectionId);
      operation.outputFormat = 'application/x-zarr';
      it('returns the non-variable subsetter service that does support the format', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        expect(serviceConfig.name).to.equal('non-variable-subsetter');
      });
    });

    describe('requesting variable subsetting and a format not supported by any services', function () {
      const operation = new DataOperation();
      operation.addSource(collectionId, [{ meta: { 'concept-id': 'V123-PROV1' }, umm: { Name: 'the-var' } }]);
      operation.outputFormat = 'image/foo';

      it('returns the no op service', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        expect(serviceConfig.name).to.equal('noOpService');
      });

      it('uses the correct service class when building the service', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        const service = buildService(serviceConfig, operation);
        expect(service.constructor.name).to.equal('NoOpService');
      });

      it('indicates the reason for choosing the no op service is the format', function () {
        const serviceConfig = chooseServiceConfig(operation, {}, this.config);
        expect(serviceConfig.message).to.equal('the requested combination of operations: variable subsetting and reformatting to image/foo on C123-TEST is unsupported');
      });
    });
  });

  describe("when the operation's collection is not configured for services", function () {
    beforeEach(function () {
      const collectionId = 'C123-TEST';
      const operation = new DataOperation();
      operation.addSource(collectionId);
      this.operation = operation;
      this.config = [
        {
          name: 'non-matching-service',
          type: { name: 'argo' },
          collections: ['C456-NOMATCH'],
        },
      ];
    });

    it('returns the no op service', function () {
      const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
      expect(serviceConfig.name).to.equal('noOpService');
    });

    it('uses the correct service class when building the service', function () {
      const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
      const service = buildService(serviceConfig, this.operation);
      expect(service.constructor.name).to.equal('NoOpService');
      expect(service.operation).to.equal(this.operation);
    });

    it('indicates the reason for choosing the no op service is the collection not being configured for services', function () {
      const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
      expect(serviceConfig.message).to.equal('no operations can be performed on C123-TEST');
    });
  });

  describe('when no services can support spatial or shapefile subsetting for the collection', function () {
    beforeEach(function () {
      const collectionId = 'C123-TEST';
      const operation = new DataOperation();
      operation.addSource(collectionId);
      this.operation = operation;
      this.config = [
        {
          name: 'a-service',
          type: { name: 'argo' },
          collections: [collectionId],
        },
      ];
    });

    describe('and the request needs spatial subsetting only', function () {
      beforeEach(function () {
        this.operation.boundingRectangle = [0, 0, 10, 10];
      });
      it('returns the no op service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('noOpService');
      });

      it('uses the correct service class when building the service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        const service = buildService(serviceConfig, this.operation);
        expect(service.constructor.name).to.equal('NoOpService');
        expect(service.operation).to.equal(this.operation);
      });

      it('indicates the reason for choosing the no op service is that spatial subsetting can not be performed', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.message).to.equal('the requested combination of operations: spatial subsetting on C123-TEST is unsupported');
      });
    });

    describe('and the request needs shapefile subsetting only', function () {
      beforeEach(function () {
        this.operation.geojson = { pretend: 'geojson' };
      });
      it('returns the no op service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.name).to.equal('noOpService');
      });

      it('uses the correct service class when building the service', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        const service = buildService(serviceConfig, this.operation);
        expect(service.constructor.name).to.equal('NoOpService');
        expect(service.operation).to.equal(this.operation);
      });

      it('indicates the reason for choosing the no op service is that shapefile subsetting can not be performed', function () {
        const serviceConfig = chooseServiceConfig(this.operation, {}, this.config);
        expect(serviceConfig.message).to.equal('the requested combination of operations: shapefile subsetting on C123-TEST is unsupported');
      });
    });
  });
});

describe('granule limits', function () {
  let stubs;
  beforeEach(() => {
    stubs = [
      stub(env, 'maxSynchronousGranules').get(() => 2),
      stub(env, 'maxAsynchronousGranules').get(() => 10),
      stub(env, 'maxGranuleLimit').get(() => 30),
    ];
  });
  afterEach(() => {
    stubs.map((s) => s.restore());
  });

  describe('when the service allows more than the granule limit for sync requests', function () {
    it('returns the system granule limit', function () {
      expect(getMaxSynchronousGranules({ maximum_sync_granules: 50 })).to.equal(30);
    });
  });

  describe('when the service allows more than the granule limit for async requests', function () {
    it('returns the system granule limit', function () {
      expect(getMaxAsynchronousGranules({ maximum_async_granules: 50 })).to.equal(30);
    });
  });

  describe('when the service allows less than the granule limit for sync requests', function () {
    it('returns the service specific sync granules limit', function () {
      expect(getMaxSynchronousGranules({ maximum_sync_granules: 25 })).to.equal(25);
    });
  });

  describe('when the service allows less than the granule limit for async requests', function () {
    it('returns the service specific async granules limit', function () {
      expect(getMaxAsynchronousGranules({ maximum_async_granules: 25 })).to.equal(25);
    });
  });

  describe('when the service allows exactly the granule limit for sync requests', function () {
    it('returns the correct limit', function () {
      expect(getMaxSynchronousGranules({ maximum_sync_granules: 30 })).to.equal(30);
    });
  });

  describe('when the service allows exactly the granule limit for async requests', function () {
    it('returns the correct limit', function () {
      expect(getMaxAsynchronousGranules({ maximum_async_granules: 30 })).to.equal(30);
    });
  });

  describe('when the service does not configure a granule limit for sync requests', function () {
    it('returns the default sync granules limit', function () {
      expect(getMaxSynchronousGranules({})).to.equal(2);
    });
  });

  describe('when the service does not configure a granule limit for async requests', function () {
    it('returns the default async granules limit', function () {
      expect(getMaxAsynchronousGranules({})).to.equal(10);
    });
  });

  describe('when the service configures a granule limit for sync requests that is less than the default', function () {
    it('returns the service specific limit', function () {
      expect(getMaxSynchronousGranules({ maximum_sync_granules: 1 })).to.equal(1);
    });
  });

  describe('when the service does not configure a granule limit for async requests that is less than the default', function () {
    it('returns the service specific limit', function () {
      expect(getMaxAsynchronousGranules({ maximum_async_granules: 1 })).to.equal(1);
    });
  });

  describe('when the service configures a granule limit for sync requests to be zero', function () {
    it('returns zero for the limit', function () {
      expect(getMaxSynchronousGranules({ maximum_sync_granules: 0 })).to.equal(0);
    });
  });

  describe('when the service configures a granule limit for async requests to be zero', function () {
    it('returns zero for the limit', function () {
      expect(getMaxAsynchronousGranules({ maximum_async_granules: 0 })).to.equal(0);
    });
  });
});
