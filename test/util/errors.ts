import { describe, it } from 'mocha';
import { expect } from 'chai';
import { buildErrorResponse, HttpError } from '../../app/util/errors';

describe('util/errors', function () {
  describe('buildErrorResponse', function () {
    describe('an error that does not have any http code associated with it', function () {
      const error = new Error('Some error');

      describe('when passing just the error in', function () {
        it('returns an internal server error', function () {
          expect(buildErrorResponse(error as HttpError)).to.eql({
            code: 'harmony.ServerError',
            description: 'Error: Internal server error.',
          });
        });
      });

      describe('when passing an error code in', function () {
        const code = 'harmony.testError';
        it('constructs an error with that error code and the message from the original error', function () {
          expect(buildErrorResponse(error as HttpError, code)).to.eql({
            code: 'harmony.testError',
            description: 'Error: Some error',
          });
        });
      });
    });

    describe('an HttpError with an HTTP code associated with it', function () {
      const httpError = new HttpError(400, 'Request was invalid');

      describe('when passing just the error in', function () {
        it('constructs an error response based on the HttpError type and the message passed to that error', function () {
          expect(buildErrorResponse(httpError)).to.eql({
            code: 'harmony.HttpError',
            description: 'Error: Request was invalid',
          });
        });
      });

      describe('when passed an error code', function () {
        const code = 'secret.OverwrittenCode';
        it('uses that as the error code in the response that is constructed', function () {
          expect(buildErrorResponse(httpError, code)).to.eql({
            code: 'secret.OverwrittenCode',
            description: 'Error: Request was invalid',
          });
        });
      });

      describe('when passed an error code and a message', function () {
        const code = 'secret.testCode';
        const message = 'Overwrote the message';
        it('uses that as the error code in the response that is constructed', function () {
          expect(buildErrorResponse(httpError, code, message)).to.eql({
            code: 'secret.testCode',
            description: 'Error: Overwrote the message',
          });
        });
      });

      describe('when the error message is JSON formatted', function () {
        const jsonMessage = '{"foo": "bar", "a": true, "b": 1}';
        const jsonError = new HttpError(403, jsonMessage);

        describe('when passing in just the error', function () {
          it('removes the description field and includes the JSON fields from the message', function () {
            expect(buildErrorResponse(jsonError)).to.eql({
              code: 'harmony.HttpError',
              foo: 'bar',
              a: true,
              b: 1,
            });
          });
        });
      });

      describe('when the message is empty', function () {
        const message = '';
        const error = new HttpError(403, message);
        it('returns an error with a code and description field with the default Error', function () {
          expect(buildErrorResponse(error)).to.eql({
            code: 'harmony.HttpError',
            description: 'Error: Error',
          });
        });
      });
    });
  });
});
