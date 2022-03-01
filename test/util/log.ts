import { describe, it } from 'mocha';
import { expect } from 'chai';
import { redact } from '../../app/util/log';
import DataOperation from '../../app/models/data-operation';

describe('util/log', function () {
  describe('redact', function () {
    it('redacts access tokens when the token is a top level key', function () {
      const objToRedact = { accessToken: 'token-that-should-be-redacted' };
      redact(objToRedact, [/token/i]);
      expect(objToRedact).to.deep.equal({ accessToken: '<redacted>' });
    });

    it('redacts multiple sensitive values from the same object', function () {
      const objToRedact = { 
        accessToken: 'token-that-should-be-redacted',
        nested: {
          apiKey: 'api-key-that-should-be-redacted',
        },
      };
      redact(objToRedact, [/token/i, /apiKey/i]);
      expect(objToRedact).to.deep.equal({ accessToken: '<redacted>', nested: { apiKey: '<redacted>' } });
    });

    it('redacts access tokens from nested objects', function () {
      const objToRedact = { nested: { accessToken: 'token-that-should-be-redacted' } };
      redact(objToRedact, [/token/i]);
      expect(objToRedact).to.deep.equal({ nested: { accessToken: '<redacted>' } });
    });

    it('redacts access tokens from DataOperations', function () {
      const objToRedact = new DataOperation();
      objToRedact.model.accessToken = 'token-that-should-be-redacted';
      redact(objToRedact, [/token/i]);
      expect(objToRedact).to.deep.equal(new DataOperation({ 
        accessToken: '<redacted>',
        sources: [],
        format: {},
        subset: {},
      }));
    });
  });
});
