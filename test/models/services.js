const { expect } = require('chai');
const { describe, it, beforeEach } = require('mocha');
const DataOperation = require('../../app/models/data-operation');
const { forOperation } = require('../../app/models/services');

describe('services.forOperation', function () {
  describe("when the operaton's collection is configured for two services", function () {
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
      it('selects the first service for the collection from the service configuration', function () {
        expect(() => forOperation(this.operation, {}, this.config)).to.throw('Could not find a service to reformat to any of the requested formats [image/gif] for the given collection');
      });
    });
  });

  describe("when the operaton's collection has a single configured service", function () {
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

  describe("when the operaton's collection is not configured for services", function () {
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
  });
});
