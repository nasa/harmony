import { expect } from 'chai';
import { NextFunction, Response } from 'express';
import sinon from 'sinon';

import DataOperation from '../../app/models/data-operation';
import HarmonyRequest, { addRequestContextToOperation } from '../../app/models/harmony-request';
import RequestContext from '../../app/models/request-context';

describe('addRequestContextToOperation', function () {
  it('appends context messages to an existing operation message', function () {
    const operation = new DataOperation();
    operation.message = 'Data in output files may extend outside the spatial and temporal bounds you requested.';

    const context = new RequestContext('request-id-1');
    context.messages.push('CMR query identified 48 granules, but the request has been limited to process only the first 1 granules because you requested 1 maxResults.');

    const req = {
      operation,
      context,
      user: 'test-user',
      accessToken: 'test-token',
    } as HarmonyRequest;

    const next = sinon.spy();
    addRequestContextToOperation(req, {} as Response, next as NextFunction);

    expect(operation.message).to.equal(
      'Data in output files may extend outside the spatial and temporal bounds you requested. CMR query identified 48 granules, but the request has been limited to process only the first 1 granules because you requested 1 maxResults.',
    );
    expect(next.calledOnce).to.be.true;
  });

  it('sets operation message from context messages when there is no existing message', function () {
    const operation = new DataOperation();

    const context = new RequestContext('request-id-2');
    context.messages.push('CMR query identified 48 granules, but the request has been limited to process only the first 1 granules because you requested 1 maxResults.');

    const req = {
      operation,
      context,
      user: 'test-user',
      accessToken: 'test-token',
    } as HarmonyRequest;

    const next = sinon.spy();
    addRequestContextToOperation(req, {} as Response, next as NextFunction);

    expect(operation.message).to.equal(
      'CMR query identified 48 granules, but the request has been limited to process only the first 1 granules because you requested 1 maxResults.',
    );
    expect(next.calledOnce).to.be.true;
  });
});
