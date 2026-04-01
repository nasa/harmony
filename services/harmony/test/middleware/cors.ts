import { expect } from 'chai';
import sinon from 'sinon';

import { corsHandler, optionsHandler } from '../../app/middleware/cors';

describe('cors middleware', function () {
  let req;
  let res;
  let next: sinon.SinonSpy;

  beforeEach(function () {
    req = { headers: {} };
    res = {
      setHeader: sinon.stub(),
      status: sinon.stub().returnsThis(),
      end: sinon.stub(),
    };
    next = sinon.spy();
  });

  describe('optionsHandler', function () {
    it('sets Access-Control-Allow-Origin to the request origin when present', function () {
      req.headers.origin = 'http://localhost:8080';
      optionsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Allow-Origin', 'http://localhost:8080')).to.be.true;
    });

    it('sets Access-Control-Allow-Origin to * when no origin header is present', function () {
      optionsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Allow-Origin', '*')).to.be.true;
    });

    it('sets Access-Control-Allow-Methods', function () {
      optionsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')).to.be.true;
    });

    it('sets Access-Control-Allow-Headers', function () {
      optionsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Allow-Headers', 'Authorization, Content-Type, Content-Length, Accept')).to.be.true;
    });

    it('sets Access-Control-Expose-Headers', function () {
      optionsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Expose-Headers', 'Content-Encoding, Content-Disposition')).to.be.true;
    });

    it('sets Access-Control-Max-Age', function () {
      optionsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Max-Age', '86400')).to.be.true;
    });

    it('does not set Access-Control-Allow-Credentials which would allow the caller to see cookies returned by EDL OAuth authentication (bearer tokens must be used)', function () {
      optionsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Allow-Credentials', 'true')).to.be.false;
    });

    it('responds with 204 and no body', function () {
      optionsHandler(req, res, next);
      expect(res.status.calledWith(204)).to.be.true;
      expect(res.end.called).to.be.true;
    });

    it('does not call next', function () {
      optionsHandler(req, res, next);
      expect(next.called).to.be.false;
    });
  });

  describe('corsHandler', function () {
    it('sets Access-Control-Allow-Origin to the request origin when present', function () {
      req.headers.origin = 'http://localhost:8080';
      corsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Allow-Origin', 'http://localhost:8080')).to.be.true;
    });

    it('sets Access-Control-Allow-Origin to * when no origin header is present', function () {
      corsHandler(req, res, next);
      expect(res.setHeader.calledWith('Access-Control-Allow-Origin', '*')).to.be.true;
    });

    it('calls next', function () {
      corsHandler(req, res, next);
      expect(next.called).to.be.true;
    });

    it('does not terminate the response', function () {
      corsHandler(req, res, next);
      expect(res.status.called).to.be.false;
      expect(res.end.called).to.be.false;
    });
  });
});
