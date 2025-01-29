import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import HarmonyRequest from '../../app/models/harmony-request';
import DataOperation from '../../app/models/data-operation';
import { setExtendDimensionsDefault } from '../../app/middleware/extend';

describe('extend service default value', function () {
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
            concatenation: true,
          },
        },
      },
    } as HarmonyRequest;
    this.req = harmonyRequest;
  });

  describe('and the request does not request to extend or concatenate', function () {
    it('does not set the extendDimensions', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.eql(undefined);
    });
  });

  describe('and the request specifies extend to be true', function () {
    beforeEach(function () {
      this.req.operation.extendDimensions = ['true'];
    });
    it('sets the extendDimensions to the default', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.eql(['mirror_step']);
    });
  });

  describe('and the request specifies concatenation to be true, but does not specify extend', function () {
    beforeEach(function () {
      this.req.operation.shouldConcatenate = true;
    });
    it('sets the extendDimensions to the default', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.eql(['mirror_step']);
    });
  });

  describe('and the request specifies concatenation to be true, but specifies extend to be false', function () {
    beforeEach(function () {
      this.req.operation.shouldConcatenate = true;
      this.req.query = { extend: 'false' };
    });
    it('does not set extendDimensions', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.equal(undefined);
    });
  });

  describe('and the request provides dimension extension', function () {
    beforeEach(function () {
      this.req.operation.extendDimensions = ['lat', 'lon'];
    });

    it('sets extendDimensions to the provided value, not the default', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.eql(['lat', 'lon']);
    });
  });

  describe('and the request specifies concatenation to be true, and a custom dimension', function () {
    beforeEach(function () {
      this.req.operation.shouldConcatenate = true;
      this.req.operation.extendDimensions = ['foo', 'bar'];
    });
    it('sets the extendDimensions to the user requested dimensions', function () {
      setExtendDimensionsDefault(this.req);
      expect(this.req.operation.extendDimensions).to.eql(['foo', 'bar']);
    });
  });
});

describe('extend service misconfigured without default value', function () {
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