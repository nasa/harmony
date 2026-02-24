import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  HttpError, buildJsonErrorResponse, getHttpStatusCode, getEndUserErrorMessage, getCodeForError,
  NotFoundError, ForbiddenError, ServerError, RequestValidationError, ConflictError,
  UnauthorizedError,
} from '../../app/util/errors';

describe('util/errors', function () {
  describe('when an error is thrown that is not a harmony HttpError', function () {
    const error = new Error('Super secret sensitive info here.');
    it('returns a generic error message', function () {
      expect(getEndUserErrorMessage(error as HttpError)).to.equal('Internal server error');
    });
    it('returns a 500 HTTP status code', function () {
      expect(getHttpStatusCode(error as HttpError)).to.equal(500);
    });
    it('returns a server error for the JSON code field in the error response', function () {
      expect(getCodeForError(error as HttpError)).to.equal('harmony.ServerError');
    });
  });

  describe('when a NotFound Error is thrown', function () {
    describe('with a custom message', function () {
      const error = new NotFoundError('that thing is gone');
      it('uses the custom message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('that thing is gone');
      });
      it('returns a 404 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(404);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.NotFoundError');
      });
    });
    describe('without a custom message', function () {
      const error = new NotFoundError();
      it('uses the default not found message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('The requested resource could not be found');
      });
      it('returns a 404 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(404);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.NotFoundError');
      });
    });
  });

  describe('when a Forbidden Error is thrown', function () {
    describe('with a custom message', function () {
      const error = new ForbiddenError('Who let you in here?');
      it('uses the custom message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('Who let you in here?');
      });
      it('returns a 403 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(403);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.ForbiddenError');
      });
    });
    describe('without a custom message', function () {
      const error = new ForbiddenError();
      it('uses the default forbidden message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('You do not have permission to access the requested resource');
      });
      it('returns a 403 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(403);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.ForbiddenError');
      });
    });
  });

  describe('when an Unauthorized Error is thrown', function () {
    describe('with a custom message', function () {
      const error = new UnauthorizedError('You cannot do that!');
      it('uses the custom message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('You cannot do that!');
      });
      it('returns a 401 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(401);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.UnauthorizedError');
      });
    });
    describe('without a custom message', function () {
      const error = new UnauthorizedError();
      it('uses the default unauthorized message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('You are not authorized to access the requested resource');
      });
      it('returns a 401 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(401);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.UnauthorizedError');
      });
    });
  });

  describe('when a Server Error is thrown', function () {
    describe('with a custom message', function () {
      const error = new ServerError('Oops that was my fault');
      it('uses the custom message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('Oops that was my fault');
      });
      it('returns a 500 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(500);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.ServerError');
      });
    });

    describe('without a custom message', function () {
      const error = new ServerError();
      it('uses the default server error message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('An unexpected error occurred');
      });
      it('returns a 500 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(500);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.ServerError');
      });
    });
  });

  describe('when a Request Validation Error is thrown', function () {
    describe('with a custom message', function () {
      const error = new RequestValidationError("I'm sorry Dave. I'm afraid I can't do that.");
      it('uses the custom message', function () {
        expect(getEndUserErrorMessage(error)).to.equal("I'm sorry Dave. I'm afraid I can't do that.");
      });
      it('returns a 400 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(400);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.RequestValidationError');
      });
    });

    describe('without a custom message', function () {
      const error = new RequestValidationError();
      it('uses the default request validation error message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('Invalid request');
      });
      it('returns a 400 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(400);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.RequestValidationError');
      });
    });
  });

  describe('when a Conflict Error is thrown', function () {
    describe('with a custom message', function () {
      const message = 'Sorry, the server and client were engaged in a heated argument over who ate the last' +
        "cookie. Looks like it's a crumbly conflict, but don't worry, peace negotiations are underway!";
      const error = new ConflictError(message);
      it('uses the custom message', function () {
        expect(getEndUserErrorMessage(error)).to.equal(message);
      });
      it('returns a 409 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(409);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.ConflictError');
      });
    });

    describe('without a custom message', function () {
      const error = new ConflictError();
      it('uses the default conflict error message', function () {
        expect(getEndUserErrorMessage(error)).to.equal('Conflict error');
      });
      it('returns a 409 HTTP status code', function () {
        expect(getHttpStatusCode(error)).to.equal(409);
      });
      it('returns an appropriate type for the code', function () {
        expect(getCodeForError(error)).to.equal('harmony.ConflictError');
      });
    });
  });

  describe('#buildJsonErrorResponse', function () {
    it('generates an appropriate JSON error field with code and message keys', function () {
      expect(buildJsonErrorResponse('harmony.testError', 'some kind of problem')).to.eql({
        code: 'harmony.testError',
        description: 'Error: some kind of problem',
      });
    });
  });
});
