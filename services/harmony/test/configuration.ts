import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookServersStartStop from './helpers/servers';
import { hookConfigureLogLevel } from './helpers/configuration';


describe('/core/configuration', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });
  describe('/log-level', function () {
    describe('when the user is part of the core permissions group', function () {
      describe('and makes a request using only the level parameter and a valid value', function () {
        hookConfigureLogLevel({ username: 'coraline', query: { level: 'error' } });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
      describe('and passes a valid parameter value with mixed case', function () {
        hookConfigureLogLevel({ username: 'coraline', query: { level: 'eRrOr' } });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
      describe('and passes in a bogus parameter', function () {
        hookConfigureLogLevel({ username: 'coraline', query: { bogus: 'error', level: 'error' } });
        it('returns an HTTP 400 response', function () {
          const error = JSON.parse(this.res.text);
          expect(this.res.statusCode).to.equal(400);
          expect(error).to.eql({
            'code': 'harmony.RequestValidationError',
            'description': 'Error: Must set log level using a single query parameter (level).',
          });
        });
      });
      describe('and passes in an invalid parameter value', function () {
        hookConfigureLogLevel({ username: 'coraline', query: { level: 'hi' } });
        it('returns an HTTP 400 response', function () {
          const error = JSON.parse(this.res.text);
          expect(this.res.statusCode).to.equal(400);
          expect(error).to.eql({
            'code': 'harmony.RequestValidationError',
            'description': 'Error: Requested to configure log level with invalid level (hi). Valid levels are: error, warn, info, http, verbose, debug, and silly.',
          });
        });
      });
    });
    describe('when the user is not part of the core permissions group', function () {
      hookConfigureLogLevel({ username: 'tim' });
      it('returns a 403 Forbidden HTTP response', function () {
        expect(this.res.statusCode).to.equal(403);
      });
    });
  });
});
