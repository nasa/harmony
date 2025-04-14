import { expect } from 'chai';
import { NextFunction, Response } from 'express';
import sinon from 'sinon';

import chooseService from '../../app/middleware/service-selection';
import DataOperation from '../../app/models/data-operation';
import HarmonyRequest from '../../app/models/harmony-request';
import * as serviceUtils from '../../app/models/services';
import env from '../../app/util/env';

describe('chooseService middleware', () => {
  let req: Partial<HarmonyRequest>;
  let res: Partial<Response>;
  let nextFunction: sinon.SinonSpy;
  let allowServiceSelectionStub: sinon.SinonStub;
  let getServiceConfigsStub: sinon.SinonStub;

  beforeEach(() => {
    req = {
      query: {},
      operation: { sources: [] } as unknown as DataOperation,
      context: { collections: [], collectionIds: [] },
    };
    res = {};
    nextFunction = sinon.spy();
    allowServiceSelectionStub = sinon.stub(env, 'allowServiceSelection');
    getServiceConfigsStub = sinon.stub(serviceUtils, 'getServiceConfigs');
  });

  afterEach(() => {
    allowServiceSelectionStub.restore();
    getServiceConfigsStub.restore();
  });

  it('should call next() if operation.sources is not defined', () => {
    chooseService(req as HarmonyRequest, res as Response, nextFunction as NextFunction);
    expect(nextFunction.calledOnce).to.be.true;
    expect(nextFunction.firstCall.args).to.have.lengthOf(0);
  });

  it('should choose a service config when serviceId is provided', () => {
    req.query = { serviceid: 'TestServiceId' };
    const mockServiceConfig = { name: 'TestService', umm_s: 'TestServiceId', collections: [] };
    allowServiceSelectionStub.value(true);
    getServiceConfigsStub.returns([mockServiceConfig]);

    chooseService(req as HarmonyRequest, res as Response, nextFunction as NextFunction);
    expect(req.context.serviceConfig).to.equal(mockServiceConfig);
    expect(nextFunction.calledOnce).to.be.true;
    expect(nextFunction.firstCall.args).to.have.lengthOf(0);
  });

  it('should throw an error when service selection is disabled', () => {
    req.query = { serviceid: 'TestServiceId' };
    allowServiceSelectionStub.value(false);

    chooseService(req as HarmonyRequest, res as Response, nextFunction as NextFunction);
    expect(nextFunction.calledOnce).to.be.true;
    expect(nextFunction.firstCall.args[0]).to.be.an.instanceOf(Error);
    expect(nextFunction.firstCall.args[0].message).to.equal('Requesting a service chain using serviceId is disabled in this environment.');
  });

  it('should throw an error when serviceId is not found', () => {
    req.query = { serviceid: 'NonexistentServiceId' };
    allowServiceSelectionStub.value(true);
    getServiceConfigsStub.returns([]);

    chooseService(req as HarmonyRequest, res as Response, nextFunction as NextFunction);
    expect(nextFunction.calledOnce).to.be.true;
    expect(nextFunction.firstCall.args[0]).to.be.an.instanceOf(Error);
    expect(nextFunction.firstCall.args[0].message).to.equal('Could not find a service chain that matched the provided serviceId. Ensure the provided serviceId is either a CMR concept ID or the name of the chain in services.yml');
  });

  it('should add collections to the service config when serviceId is provided', () => {
    req.query = { serviceid: 'TestServiceId' };
    req.context.collectionIds = ['collection1', 'collection2'];
    const mockServiceConfig = { name: 'TestService', umm_s: 'TestServiceId', collections: [] };
    allowServiceSelectionStub.value(true);
    getServiceConfigsStub.returns([mockServiceConfig]);

    chooseService(req as HarmonyRequest, res as Response, nextFunction as NextFunction);
    expect(req.context.serviceConfig.collections).to.have.lengthOf(2);
    expect(req.context.serviceConfig.collections[0].id).to.equal('collection1');
    expect(req.context.serviceConfig.collections[1].id).to.equal('collection2');
  });
});