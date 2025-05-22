import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, beforeEach, afterEach } from 'mocha';

import { validateGranules } from '../app/query';
import * as cmr from '../../harmony/app/util/cmr';
import { CmrError, RequestValidationError, ServerError } from '../../harmony/app/util/errors';
import logger from '../../harmony/app/util/log';
import DataOperation from '../../harmony/app/models/data-operation';

describe('validateGranules', function () {
  let fetchStub: sinon.SinonStub;
  let logStub: sinon.SinonStub;
  const scrollId = 'dummy-scroll-id';
  const maxCmrGranules = 1;

  const baseOperation = new DataOperation({
    requestId: 'test-request-id',
    unencryptedAccessToken: 'token123',
    sources: [{ collection: 'C001-TEST' }],
    // optionally set extraArgs for granValidation in individual tests
  });

  beforeEach(() => {
    fetchStub = sinon.stub(cmr, 'queryGranulesWithSearchAfter');
    logStub = sinon.stub(logger, 'info');
  });

  afterEach(() => {
    fetchStub.restore();
    logStub.restore();
  });

  it('returns error when zero granules are found', async function () {
    fetchStub.resolves({ hits: 0 });

    const result = await validateGranules(baseOperation, scrollId, maxCmrGranules, logger);
    expect(result.hits).to.equal(0);
    expect(result.error).to.equal('No matching granules found.');
    expect(result.errorLevel).to.equal('error');
    expect(result.errorCategory).to.equal('granValidation');
  });

  it('returns success with warning if hits are found and limit message is present', async function () {
    const operationWithLimit = new DataOperation({
      ...baseOperation.model,
      extraArgs: {
        granValidation: {
          reason: 3,
          hasGranuleLimit: true,
          serviceName: 'myService',
          maxResults: 1,
        },
      },
    });

    fetchStub.resolves({ hits: 3 });

    const result = await validateGranules(operationWithLimit, scrollId, maxCmrGranules, logger);
    expect(result.hits).to.equal(3);
    expect(result.errorLevel).to.equal('warning');
    expect(result.errorCategory).to.equal('granValidation');
    expect(result.error).to.equal('CMR query identified 3 granules, but the request has been limited to process only the first 1 granules because of system constraints.');
  });

  it('returns success with no error message if no limits apply', async function () {
    fetchStub.resolves({ hits: 1 });

    const result = await validateGranules(baseOperation, scrollId, maxCmrGranules, logger);
    expect(result.hits).to.equal(1);
    expect(result.errorLevel).to.equal('warning');
    expect(result.errorCategory).to.equal('granValidation');
    expect(result.error).to.be.undefined;
  });

  it('handles CMR errors gracefully and returns validation error info', async function () {
    const error = new CmrError(400, 'Bad CMR request');
    fetchStub.rejects(error);

    const result = await validateGranules(baseOperation, scrollId, maxCmrGranules, logger);
    expect(result.hits).to.equal(0);
    expect(result.error).to.equal('Bad CMR request');
    expect(result.errorLevel).to.equal('error');
    expect(result.errorCategory).to.equal('granValidation');
  });

  it('wraps shapeType in GeoJSON errors', async function () {
    const operationWithShape = new DataOperation({
      ...baseOperation.model,
      extraArgs: {
        granValidation: {
          shapeType: 'Shapefile',
        },
      },
    });

    const geoJsonError = new RequestValidationError('Invalid GeoJSON provided');
    fetchStub.rejects(geoJsonError);

    const result = await validateGranules(operationWithShape, scrollId, maxCmrGranules, logger);
    expect(result.error).to.include('GeoJSON (converted from the provided Shapefile)');
    expect(result.errorLevel).to.equal('error');
    expect(result.errorCategory).to.equal('granValidation');
  });

  it('throws a ServerError on unexpected failure', async function () {
    fetchStub.rejects(new Error('Unexpected failure'));

    await expect(validateGranules(baseOperation, scrollId, maxCmrGranules, logger)).to.be.rejectedWith(ServerError, 'Failed to query the CMR');
  });
});
