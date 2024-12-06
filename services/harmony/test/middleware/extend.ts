import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { v4 as uuid } from 'uuid';
import { asyncLocalStorage } from '../../app/util/async-store';
import HarmonyRequest from '../../app/models/harmony-request';
import DataOperation from '../../app/models/data-operation';
import { setExtendDimensionsDefault } from '../../app/middleware/extend';
import RequestContext from '../../app/models/request-context';

describe('extend serivce default value', function () {
  const collectionId = 'C123-TEST';
  const requestContext = new RequestContext(uuid());
  requestContext.serviceConfig = {
    name: 'extend-service',
    type: { name: 'turbo' },
    collections: [{ id: collectionId }],
    capabilities: {
      extend: true,
      default_extend_dimensions: ['mirror_step'],
    },
  };

  beforeEach(function () {
    const shortName = 'harmony_example';
    const versionId = '1';
    const operation = new DataOperation();
    operation.addSource(collectionId, shortName, versionId);
    const harmonyRequest = {
      operation: operation,
    } as HarmonyRequest;
    this.req = harmonyRequest;
  });

  describe('and the request does not provide dimension extension', function () {
    it('extendDimensions is set to the default', function () {
      asyncLocalStorage.run(requestContext, () => {
        setExtendDimensionsDefault(this.req);
        expect(this.req.operation.extendDimensions).to.eql(['mirror_step']);
      });
    });
  });

  describe('and the request provides dimension extension', function () {
    beforeEach(function () {
      this.req.operation.extendDimensions = ['lat', 'lon'];
    });

    it('extendDimensions is set to the provided value, not the default', function () {
      asyncLocalStorage.run(requestContext, () => {
        setExtendDimensionsDefault(this.req);
        expect(this.req.operation.extendDimensions).to.eql(['lat', 'lon']);
      });
    });
  });
});

describe('extend serivce misconfigured without default value', function () {
  const collectionId = 'C123-TEST';
  const requestContext = new RequestContext(uuid());
  requestContext.serviceConfig = {
    name: 'extend-service',
    type: { name: 'turbo' },
    collections: [{ id: collectionId }],
    capabilities: {
      extend: true,
    },
  };

  beforeEach(function () {
    const shortName = 'harmony_example';
    const versionId = '1';
    const operation = new DataOperation();
    operation.addSource(collectionId, shortName, versionId);
    const harmonyRequest = {
      operation: operation,
    } as HarmonyRequest;
    this.req = harmonyRequest;
  });

  describe('and the request does not provide dimension extension', function () {
    it('extendDimensions is set to the default', function () {
      asyncLocalStorage.run(requestContext, () => {
        setExtendDimensionsDefault(this.req);
        expect(this.req.operation.extendDimensions).to.not.exist;
      });
    });
  });

  describe('and the request provides dimension extension', function () {
    beforeEach(function () {
      this.req.operation.extendDimensions = ['lat', 'lon'];
    });

    it('extendDimensions is set to the provided value, not the default', function () {
      asyncLocalStorage.run(requestContext, () => {
        setExtendDimensionsDefault(this.req);
        expect(this.req.operation.extendDimensions).to.eql(['lat', 'lon']);
      });
    });
  });
});