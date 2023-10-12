import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import HarmonyRequest from '../../app/models/harmony-request';
import DataOperation from '../../app/models/data-operation';
import { setExtendDimensionsDefault } from '../../app/middleware/extend';

describe('extend serivce default value', function () {
  beforeEach(function () {
    const collectionId = 'C123-TEST';
    const shortName = 'harmony_example';
    const versionId = '1';
    const operation = new DataOperation();
    operation.addSource(collectionId, shortName, versionId);
    const harmonyRequest = {
      operation: operation,
      context: {
        serviceConfig: {
          name: 'extend-service',
          type: { name: 'turbo' },
          collections: [{ id: collectionId }],
          capabilities: {
            extend: true,
            default_extend_dimensions: ['mirror_step'],
          },
        },
      },
    } as HarmonyRequest;
    this.req = harmonyRequest;
  });

  describe('and the request does not provide dimension extension', function () {
    it('extendDimensions is set to the default', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.eql(['mirror_step']);
    });
  });

  describe('and the request provides dimension extension', function () {
    beforeEach(function () {
      this.req.operation.extendDimensions = ['lat', 'lon'];
    });

    it('extendDimensions is set to the provided value, not the default', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.eql(['lat', 'lon']);
    });
  });
});

describe('extend serivce misconfigured without default value', function () {
  beforeEach(function () {
    const collectionId = 'C123-TEST';
    const shortName = 'harmony_example';
    const versionId = '1';
    const operation = new DataOperation();
    operation.addSource(collectionId, shortName, versionId);
    const harmonyRequest = {
      operation: operation,
      context: {
        serviceConfig: {
          name: 'extend-service',
          type: { name: 'turbo' },
          collections: [{ id: collectionId }],
          capabilities: {
            extend: true,
          },
        },
      },
    } as HarmonyRequest;
    this.req = harmonyRequest;
  });

  describe('and the request does not provide dimension extension', function () {
    it('extendDimensions is set to the default', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.not.exist;
    });
  });

  describe('and the request provides dimension extension', function () {
    beforeEach(function () {
      this.req.operation.extendDimensions = ['lat', 'lon'];
    });

    it('extendDimensions is set to the provided value, not the default', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.eql(['lat', 'lon']);
    });
  });
});