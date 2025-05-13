import axios from 'axios';
import { expect } from 'chai';
import { Response } from 'express';
import { before, describe, it } from 'mocha';
import sinon, { SinonStub, spy, stub } from 'sinon';
import { v4 as uuid } from 'uuid';

import { externalValidation } from '../../app/middleware/external-validation';
import DataOperation, { CURRENT_SCHEMA_VERSION } from '../../app/models/data-operation';
import HarmonyRequest from '../../app/models/harmony-request';
import { getEndUserErrorMessage, getHttpStatusCode } from '../../app/util/errors';
import logger from '../../app/util/log';

describe('external validation', function () {
  const mockResponse = (): Response => {
    const res = {} as Response;
    res.status = sinon.stub().returns(res);
    res.json = sinon.stub().returns(res);
    return res;
  };

  before(function () {
    const collectionId = 'C123-TEST';
    const shortName = 'harmony_example';
    const versionId = '1';
    const operation = new DataOperation();
    Object.assign(operation, { user: 'foo', client: 'harmony-test', requestId: uuid() });
    operation.addSource(collectionId, shortName, versionId);

    this.reqWithValidation = {
      operation: operation,
      accessToken: 'abc123',
      context: {
        serviceConfig: {
          name: 'external-valiation-service',
          type: { name: 'turbo' },
          collections: [{ id: collectionId }],
          capabilities: {
            concatenation: true,
          },
          external_validation_url: 'http://example.com',
        },
        logger,
      },
    } as HarmonyRequest;


    this.reqWithoutValidation = {
      operation: operation,
      context: {
        serviceConfig: {
          name: 'external-valiation-service',
          type: { name: 'turbo' },
          collections: [{ id: collectionId }],
          capabilities: {
            concatenation: true,
          },
        },
        logger,
      },
    } as HarmonyRequest;

    const expectedOperation = operation.clone();
    expectedOperation.stagingLocation = '';
    expectedOperation.accessToken = '';
    expectedOperation.extraArgs = { service: 'external-valiation-service' };
    this.expectedOperationJson = expectedOperation.serialize(CURRENT_SCHEMA_VERSION);

    this.res = mockResponse();
    this.next = sinon.stub().returns;

    // remove any post stub leftover from other tests
    const postStub = (axios.post as SinonStub);
    if (postStub.restore) postStub.restore();
  });

  describe('when the service does not require external validation', function () {
    let postSpy;
    before(function () {
      postSpy = spy(axios, 'post');
    });

    after(function () {
      postSpy.restore();
    });

    it('does not attempt external validation', async function () {
      await externalValidation(this.reqWithoutValidation, this.res, () => {});
      expect(postSpy.notCalled).is.true;
    });
  });

  describe('when the service requires external validation', function () {
    describe('when the validation happens', function () {
      let postStub;
      let url;
      let body;
      let options;
      before(async function () {
        postStub = stub(axios, 'post').returns(new Promise((resolve, _reject) => {
          resolve({ data: 'OK', status: 200 });
        }));
        const nextStub = stub();
        await externalValidation(this.reqWithValidation, this.res, nextStub);
        [url, body, options] = postStub.getCall(0).args;
      });

      after(function () {
        postStub.restore();
      });

      it('uses the url configured for the service', async function () {
        expect(url).to.eql(this.reqWithValidation.context.serviceConfig.external_validation_url);
      });

      it('sends the operation to the external validator', async function () {
        const nextStub = stub();
        await externalValidation(this.reqWithValidation, this.res, nextStub);
        expect(body).to.eql(this.expectedOperationJson);
      });

      it('sets the Authorization header on the request to the external validator', async function () {
        const nextStub = stub();
        await externalValidation(this.reqWithValidation, this.res, nextStub);
        expect(options.headers).to.eql({
          'Authorization': `Bearer ${this.reqWithValidation.accessToken}`,
          'Content-type': 'application/json',
        });
      });

    });

    describe('when the external validation succeeds', async function () {
      let postStub;
      before(function () {
        postStub = stub(axios, 'post').returns(new Promise((resolve, _reject) => {
          resolve({ data: 'OK', status: 200 });
        }));
      });

      after(function () {
        postStub.restore();
      });

      it('calls the next function without an error', async function () {
        const nextStub = stub();
        await externalValidation(this.reqWithValidation, this.res, nextStub);
        const { args } = nextStub.getCall(0);
        expect(args).to.eql([]);
      });
    });

    describe('when the external validation fails', async function () {
      let postStub;
      before(function () {
        postStub = stub(axios, 'post').throws({ response: { status: 403, data: 'Forbidden' } });
      });

      after(function () {
        postStub.restore();
      });
      it('returns the status code of the error', async function () {
        const nextStub = stub();
        await externalValidation(this.reqWithValidation, this.res, nextStub);
        const err = nextStub.getCall(0).args[0];
        const status = getHttpStatusCode(err);
        expect(status).to.eql(403);
      });

      it('returns the error message from the external validator', async function () {
        const nextStub = stub();
        await externalValidation(this.reqWithValidation, this.res, nextStub);
        const err = nextStub.getCall(0).args[0];
        const message = getEndUserErrorMessage(err);
        expect(message).to.eql('Forbidden');
      });
    });

    describe('when the external validation endpoint is unreachable', async function () {
      let postStub;
      before(function () {
        postStub = stub(axios, 'post').throws({ code: 'ECONNREFUSED' } );
      });

      after(function () {
        postStub.restore();
      });
      it('call the next function with the error', async function () {
        const nextStub = stub();
        await externalValidation(this.reqWithValidation, this.res, nextStub);
        const err = nextStub.getCall(0).args[0];
        expect(err).to.eql({ code: 'ECONNREFUSED' });
      });
    });

  });

});