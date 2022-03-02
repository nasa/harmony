import { describe, it } from 'mocha';
import { expect } from 'chai';
import { redact } from '../../app/util/log';
import DataOperation from '../../app/models/data-operation';

describe('util/log', function () {
  describe('redact', function () {
    it('redacts multiple sensitive values from the same object', function () {
      const objToRedact = { 
        accessToken: 'token-that-should-be-redacted',
        nested: {
          apiKey: 'api-key-that-should-be-redacted',
        },
      };
      const objAfterRedaction = { 
        accessToken: '<redacted>', 
        nested: { 
          apiKey: '<redacted>',
        }, 
      };
      redact(objToRedact, [/token/i, /apiKey/i]);
      expect(objToRedact).to.deep.equal(objAfterRedaction);
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

    it('does not loop infinitely if a circular reference is encountered', function () {
      const objToRedact = { 
        accessToken: 'token-that-should-be-redacted',
        anObject: {
          circularRef: null,
        },
      };
      objToRedact.anObject.circularRef = objToRedact;
      redact(objToRedact, [/token/i]);
      expect(objToRedact.accessToken).to.equal('<redacted>');
    });
  });
});
