import { describe, it } from 'mocha';
import { expect } from 'chai';
import { redact } from '../../app/util/log';
import DataOperation from '../../app/models/data-operation';

describe('util/log', function () {
  describe('redact', function () {
    it('returns a cloned and redacted object when accessToken is present', function () {
      const objToRedact = { 
        accessToken: 'token-that-should-be-redacted',
        otherKey: 'other logged info',
      };
      const redacted = redact(objToRedact);
      expect(redacted).to.deep.equal({ 
        accessToken: '<redacted>', 
        otherKey: 'other logged info',
      });
      // check that the original object wasn't modified
      expect(objToRedact.accessToken).to.equal('token-that-should-be-redacted');
    });

    it('returns a cloned and redacted DataOperation when given a DataOperation', function () {
      const objToRedact = new DataOperation();
      objToRedact.model.accessToken = 'token-that-should-be-redacted';
      const redacted = redact(objToRedact);
      expect(redacted).to.deep.equal(new DataOperation({ 
        accessToken: '<redacted>',
        sources: [],
        format: {},
        subset: {},
      }));
      // check that the original object wasn't modified
      expect(objToRedact.model.accessToken).to.equal('token-that-should-be-redacted');
    });

    it('returns a cloned and redacted DataOperation when the DataOperation is a property of another object', function () {
      const objToRedact = { 'nested': new DataOperation() };
      objToRedact.nested.model.accessToken = 'token-that-should-be-redacted';
      const redacted = redact(objToRedact);
      expect(redacted).to.deep.equal({
        nested: new DataOperation({ 
          accessToken: '<redacted>',
          sources: [],
          format: {},
          subset: {},
        }),
      });
      // check that the original object wasn't modified
      expect(objToRedact.nested.model.accessToken).to.equal('token-that-should-be-redacted');
    });
  });
});
