import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookServersStartStop from './helpers/servers';
import { hookConfigureLogLevel } from './helpers/configuration';


describe('/admin/configuration', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  describe('/log-level', function () {
    describe('when the user is part of the admin group', function () {
      describe('and makes a request using only the level parameter and a valid value', function () {
        hookConfigureLogLevel({ username: 'adam', query: { level: 'error' } });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });     
      describe('and passes a valid parameter value with mixed case', function () {
        hookConfigureLogLevel({ username: 'adam', query: { level: 'eRrOr' } });
        it('returns an HTTP success response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });     
      describe('and passes in a bogus parameter', function () {
        hookConfigureLogLevel({ username: 'adam', query: { bogus: 'error', level: 'error' } });
        it('returns an HTTP 400 response', function () {
          expect(this.res.statusCode).to.equal(400);
        });
      });      
      describe('and passes in an invalid parameter value', function () {
        hookConfigureLogLevel({ username: 'adam', query: { level: 'hi' } });
        it('returns an HTTP 400 response', function () {
          expect(this.res.statusCode).to.equal(400);
        });
      });
    });  
    describe('when the user is not part of the admin group', function () {
      hookConfigureLogLevel({ username: 'tim' });
      it('returns a 403 Forbidden HTTP response', function () {
        expect(this.res.statusCode).to.equal(403);
      });
    });
  });
});
