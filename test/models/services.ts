import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import DataOperation from '../../app/models/data-operation';
import { forOperation } from '../../app/models/services';
import AsynchronizerService from '../../app/models/services/asynchronizer-service';

describe('services.forOperation', function () {
  describe("when the operation's collection is configured for two services", function () {
    beforeEach(function () {
      const collectionId = 'C123-TEST';
      const operation = new DataOperation();
      operation.addSource(collectionId);
      this.operation = operation;
      this.config = [
        {
          name: 'first-service',
          type: { name: 'docker' },
          collections: [collectionId],
          capabilities: { output_formats: ['image/tiff'] },
        },
        {
          name: 'second-service',
          type: { name: 'http' },
          collections: [collectionId],
          capabilities: { output_formats: ['image/tiff', 'image/png'] },
        },
      ];
    });

    describe('and both can produce the requested output type', function () {
      beforeEach(function () {
        this.operation.outputFormat = 'image/tiff';
      });

      it('returns the first service for the collection from the service configuration', function () {
        const service = forOperation(this.operation, {}, this.config);
        expect(service.config.name).to.equal('first-service');
        expect(service.constructor.name).to.equal('LocalDockerService');
      });
    });

    describe('and only the second can produce the requested output type', function () {
      beforeEach(function () {
        this.operation.outputFormat = 'image/png';
      });
      it('returns the second service for the collection from the service configuration', function () {
        const service = forOperation(this.operation, {}, this.config);
        expect(service.config.name).to.equal('second-service');
        expect(service.constructor.name).to.equal('HttpService');
      });
    });

    describe('and neither can produce the requested output type', function () {
      beforeEach(function () {
        this.operation.outputFormat = 'image/gif';
      });
      it('returns the no-op service', function () {
        const service = forOperation(this.operation, {}, this.config);
        expect(service.constructor.name).to.equal('NoOpService');
      });
      it('returns a message indicating that there were no services that could support the provided format', function () {
        const service = forOperation(this.operation, {}, this.config);
        expect(service.message).to.equal('Returning direct download links because none of the services configured for the collection support reformatting to any of the requested formats [image/gif].');
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
          type: { name: 'docker' },
          collections: ['C456-NOMATCH'],
        },
        {
          name: 'matching-service',
          type: { name: 'docker' },
          collections: [collectionId],
        },
      ];
    });

    it('returns the service configured for the collection', function () {
      const service = forOperation(this.operation, {}, this.config);
      expect(service.config.name).to.equal('matching-service');
      expect(service.constructor.name).to.equal('LocalDockerService');
    });
  });

  describe('when one out of two services support variable subsetting', function () {
    const collectionId = 'C123-TEST';
    beforeEach(function () {
      this.config = [
        {
          name: 'variable-subsetter',
          type: { name: 'docker' },
          capabilities: {
            subsetting: { variable: true },
            output_formats: ['image/tiff'],
          },
          collections: [collectionId],
        },
        {
          name: 'non-variable-subsetter',
          type: { name: 'docker' },
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
      operation.addSource(collectionId, [{ id: 'V123-PROV1', name: 'the-var' }]);
      operation.outputFormat = 'image/tiff';
      it('returns the service configured for variable subsetting', function () {
        const service = forOperation(operation, {}, this.config);
        expect(service.config.name).to.equal('variable-subsetter');
        expect(service.constructor.name).to.equal('LocalDockerService');
      });
    });

    describe('requesting variable subsetting with an output format that is not supported by the variable subsetting service, but is supported by other services', function () {
      const operation = new DataOperation();
      operation.addSource(collectionId, [{ id: 'V123-PROV1', name: 'the-var' }]);
      operation.outputFormat = 'application/x-zarr';
      it('returns the no op service', function () {
        const service = forOperation(operation, {}, this.config);
        expect(service.constructor.name).to.equal('NoOpService');
      });
      it('indicates the reason for choosing the no op service is the combination of variable subsetting and the output format', function () {
        const service = forOperation(operation, {}, this.config);
        expect(service.config.message).to.equal('none of the services support the combination of both variable subsetting and any of the requested formats [application/x-zarr]');
      });
    });

    describe('requesting no variable subsetting and a format supported by the service that does not support variable subsetting', function () {
      const operation = new DataOperation();
      operation.addSource(collectionId);
      operation.outputFormat = 'application/x-zarr';
      it('returns the non-variable subsetter service that does support the format', function () {
        const service = forOperation(operation, {}, this.config);
        expect(service.config.name).to.equal('non-variable-subsetter');
      });
    });

    describe('requesting variable subsetting and a format not supported by any services', function () {
      const operation = new DataOperation();
      operation.addSource(collectionId, [{ id: 'V123-PROV1', name: 'the-var' }]);
      operation.outputFormat = 'image/foo';
      it('returns the no op service', function () {
        const service = forOperation(operation, {}, this.config);
        expect(service.constructor.name).to.equal('NoOpService');
      });
      it('indicates the reason for choosing the no op service is the format', function () {
        const service = forOperation(operation, {}, this.config);
        expect(service.config.message).to.equal('none of the services configured for the collection support reformatting to any of the requested formats [image/foo]');
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
          type: { name: 'docker' },
          collections: ['C456-NOMATCH'],
        },
      ];
    });

    it('returns the no op service', function () {
      const service = forOperation(this.operation, {}, this.config);
      expect(service.constructor.name).to.equal('NoOpService');
      expect(service.operation).to.equal(this.operation);
    });

    it('indicates the reason for choosing the no op service is the collection not being configured for services', function () {
      const service = forOperation(this.operation, {}, this.config);
      expect(service.config.message).to.equal('no services are configured for the collection');
    });
  });

  describe('when the service configuration indicates the service can only handle synchronous, one-granule requests', function () {
    beforeEach(function () {
      const collectionId = 'C123-TEST';
      const operation = new DataOperation();
      operation.addSource(collectionId);
      this.operation = operation;
      this.config = [
        {
          name: 'matching-service',
          type: { name: 'docker', synchronous_only: true },
          collections: [collectionId],
        },
      ];
    });
    it('returns a service configured to allow asynchronous calls through a wrapper', function () {
      const op = this.operation;
      const service = forOperation(op, {}, this.config) as AsynchronizerService<unknown>;
      expect(service.constructor.name).to.equal('AsynchronizerService');
      expect(service.SyncServiceClass.name).to.equal('LocalDockerService');
    });
  });
});
