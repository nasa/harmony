import { expect } from 'chai';
import sinon from 'sinon';

import { getRetryStatistics } from '../app/frontends/retry-stats';
import * as workItemModule from '../app/models/work-item';
import { RequestValidationError } from '../app/util/errors';

describe('getRetryStatistics', () => {
  let req, res, next, getRetryCountsStub: sinon.SinonStub;

  beforeEach(() => {
    req = {
      query: {},
      user: 'test-user',
      context: {
        logger: {
          info: sinon.stub(),
          error: sinon.stub(),
        },
      },
      accepts: sinon.stub(),
    };

    res = {
      json: sinon.stub(),
      render: sinon.stub(),
    };

    next = sinon.stub();

    // Stub out the getRetryCounts function to return the data we want for each test
    getRetryCountsStub = sinon.stub(workItemModule, 'getRetryCounts');
  });

  afterEach(() => {
    getRetryCountsStub.restore();
  });

  describe('Basic functionality', () => {
    it('should return JSON response with correct calculations for typical retry data', async () => {
      const mockRetryData = {
        0: 100,
        1: 20,
        2: 10,
        3: 5,
        4: 3,
        5: 2,
      };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      sinon.assert.calledOnceWithExactly(getRetryCountsStub, sinon.match.any, 60);
      sinon.assert.calledOnce(res.json);

      const result = res.json.firstCall.args[0];
      expect(result).to.deep.equal({
        numMinutes: 60,
        counts: mockRetryData,
        totalWorkItems: 140,    // 100 + 20 + 10 + 5 + 3 + 2
        totalRetries: 77,       // 0*100 + 1*20 + 2*10 + 3*5 + 4*3 + 5*2
        percentSuccessful: '64.52%',
        percentRetried: '35.48%',
      });
    });

    it('should use custom numMinutes from query parameter', async () => {
      const mockRetryData = { 0: 10, 1: 5, 2: 3, 3: 2, 4: 1, 5: 0 };

      getRetryCountsStub.resolves(mockRetryData);
      req.query = { numMinutes: '120' };
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      sinon.assert.calledWithExactly(getRetryCountsStub, sinon.match.any, 120);
      expect(res.json.firstCall.args[0].numMinutes).to.equal(120);
    });

    it('should handle case-insensitive query parameters', async () => {
      const mockRetryData = { 0: 10, 1: 5, 2: 3, 3: 2, 4: 1, 5: 0 };

      getRetryCountsStub.resolves(mockRetryData);
      req.query = { NumMinutes: '90' };
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      sinon.assert.calledWithExactly(getRetryCountsStub, sinon.match.any, 90);
    });
  });

  describe('Edge cases', () => {
    it('should handle all zero counts', async () => {
      const mockRetryData = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.totalWorkItems).to.equal(0);
      expect(result.totalRetries).to.equal(0);
      expect(result.percentSuccessful).to.equal('0.00%');
      expect(result.percentRetried).to.equal('0.00%');
    });

    it('should handle only successful items (no retries)', async () => {
      const mockRetryData = { 0: 50, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.totalWorkItems).to.equal(50);
      expect(result.totalRetries).to.equal(0);
      expect(result.percentSuccessful).to.equal('100.00%');
      expect(result.percentRetried).to.equal('0.00%');
    });

    it('should handle only retried items (no successes on first try)', async () => {
      const mockRetryData = { 0: 0, 1: 10, 2: 5, 3: 3, 4: 2, 5: 1 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.totalWorkItems).to.equal(21);
      expect(result.totalRetries).to.equal(42); // 1*10 + 2*5 + 3*3 + 4*2 + 5*1
      expect(result.percentSuccessful).to.equal('33.33%');
      expect(result.percentRetried).to.equal('66.67%');
    });

    it('should handle missing retry count keys gracefully', async () => {
      const mockRetryData = { 0: 10, 2: 5, 4: 3 }; // Missing keys 1, 3, 5

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.totalWorkItems).to.equal(18);
      expect(result.totalRetries).to.equal(22); // 0*10 + 2*5 + 4*3
      expect(result.percentSuccessful).to.equal('45.00%');
      expect(result.percentRetried).to.equal('55.00%');
    });

    it('should handle unexpected retry count keys correctly', async () => {
      const mockRetryData = { 0: 10, 20: 5 }; // Unexpected 20

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.totalWorkItems).to.equal(15);
      expect(result.totalRetries).to.equal(100); // 0*10 + 20*5
      expect(result.percentSuccessful).to.equal('13.04%');
      expect(result.percentRetried).to.equal('86.96%');
    });

    it('should throw a RequestValidationError if numMinutes is not an integer', async () => {
      req.query = { numMinutes: 'invalid' };
      req.accepts.returns('json');

      const nextSpy = sinon.spy();

      await getRetryStatistics(req, res, nextSpy);

      expect(nextSpy.calledOnce).to.be.true;
      const error = nextSpy.firstCall.args[0];
      expect(error).to.be.instanceOf(RequestValidationError);
      expect(error.message).to.equal('numMinutes must be a positive integer');
    });

    it('should throw a RequestValidationError if numMinutes is 0', async () => {
      req.query = { numMinutes: 0 };
      req.accepts.returns('json');

      const nextSpy = sinon.spy();

      await getRetryStatistics(req, res, nextSpy);

      expect(nextSpy.calledOnce).to.be.true;
      const error = nextSpy.firstCall.args[0];
      expect(error).to.be.instanceOf(RequestValidationError);
      expect(error.message).to.equal('numMinutes must be a positive integer');
    });

    it('should throw a RequestValidationError if numMinutes is negative', async () => {
      req.query = { numMinutes: -1 };
      req.accepts.returns('json');

      const nextSpy = sinon.spy();

      await getRetryStatistics(req, res, nextSpy);

      expect(nextSpy.calledOnce).to.be.true;
      const error = nextSpy.firstCall.args[0];
      expect(error).to.be.instanceOf(RequestValidationError);
      expect(error.message).to.equal('numMinutes must be a positive integer');
    });

    it('should throw a RequestValidationError if numMinutes is a float instead of an integer', async () => {
      req.query = { numMinutes: 1.2 };
      req.accepts.returns('json');

      const nextSpy = sinon.spy();

      await getRetryStatistics(req, res, nextSpy);

      expect(nextSpy.calledOnce).to.be.true;
      const error = nextSpy.firstCall.args[0];
      expect(error).to.be.instanceOf(RequestValidationError);
      expect(error.message).to.equal('numMinutes must be a positive integer');
    });
  });

  describe('HTML rendering', () => {
    it('should render HTML when client accepts HTML', async () => {
      const mockRetryData = { 0: 80, 1: 15, 2: 5, 3: 0, 4: 0, 5: 0 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('html');

      await getRetryStatistics(req, res, next);

      sinon.assert.calledOnceWithExactly(res.render, 'retry-stats', {
        numMinutes: 60,
        counts: [
          { retryCount: '0', count: 80 },
          { retryCount: '1', count: 15 },
          { retryCount: '2', count: 5 },
          { retryCount: '3', count: 0 },
          { retryCount: '4', count: 0 },
          { retryCount: '5', count: 0 },
        ],
        totalWorkItems: 100,
        totalRetries: 25,
        percentSuccessful: '80.0',  // Note: no % sign for HTML
        percentRetried: '20.0',
      });
    });

    it('should sort counts array correctly for HTML rendering', async () => {
      const mockRetryData = { 5: 1, 0: 10, 3: 2, 1: 5, 4: 1, 2: 3 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('html');

      await getRetryStatistics(req, res, next);

      const renderData = res.render.firstCall.args[1];
      const { counts } = renderData;

      // Verify sorting by retryCount
      expect(counts).to.deep.equal([
        { retryCount: '0', count: 10 },
        { retryCount: '1', count: 5 },
        { retryCount: '2', count: 3 },
        { retryCount: '3', count: 2 },
        { retryCount: '4', count: 1 },
        { retryCount: '5', count: 1 },
      ]);
    });
  });

  describe('Error handling', () => {
    it('should call next with error when getRetryCounts throws', async () => {
      const error = new Error('Database connection failed');
      getRetryCountsStub.rejects(error);

      await getRetryStatistics(req, res, next);

      sinon.assert.calledWithExactly(req.context.logger.error, error);
      sinon.assert.calledWithExactly(next, error);
      sinon.assert.notCalled(res.json);
      sinon.assert.notCalled(res.render);
    });

    it('should handle synchronous errors in calculations', async () => {
      // This tests if there are any edge cases in the calculations
      const mockRetryData = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      // Should complete successfully
      sinon.assert.calledOnce(res.json);
      sinon.assert.notCalled(next);
    });
  });

  describe('Logging', () => {
    it('should log info message with user', async () => {
      const mockRetryData = { 0: 10, 1: 5, 2: 3, 3: 2, 4: 1, 5: 0 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');
      req.user = 'john.doe@example.com';

      await getRetryStatistics(req, res, next);

      sinon.assert.calledWithExactly(
        req.context.logger.info,
        'Retry statistics requested by user john.doe@example.com',
      );
    });
  });

  describe('Percentage calculations', () => {
    it('should calculate percentages correctly with decimal precision', async () => {
      const mockRetryData = { 0: 1, 1: 2 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.percentSuccessful).to.equal('60.00%'); // 3 successes and 2 failures retried
      expect(result.percentRetried).to.equal('40.00%');
    });

    it('should handle rounding edge cases', async () => {
      const mockRetryData = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 2, 7: 8 };

      getRetryCountsStub.resolves(mockRetryData);
      req.accepts.returns('json');

      await getRetryStatistics(req, res, next);

      const result = res.json.firstCall.args[0];
      expect(result.percentSuccessful).to.equal('16.67%'); // 70 retries on 14 work items (14 / 84)
      expect(result.percentRetried).to.equal('83.33%');
    });
  });
});