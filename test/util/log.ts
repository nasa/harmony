import { describe, it } from 'mocha';
import { expect } from 'chai';
import { redact } from '../../app/util/log';
import DataOperation from '../../app/models/data-operation';

describe('util/log', function () {
  describe('redact', function () {
    it('returns a cloned and redacted object when accessToken is present', function () {
      const objToRedact = { 
        accessToken: 'tokenToRedact',
        otherKey: 'other logged info',
      };
      const redactedClone = redact(objToRedact);
      expect(redactedClone).to.deep.equal({ 
        accessToken: '<redacted>', 
        otherKey: 'other logged info',
      });
      // check that the original object wasn't modified
      expect(objToRedact).to.deep.equal({ 
        accessToken: 'tokenToRedact',
        otherKey: 'other logged info',
      });
    });

    it('returns a cloned and redacted DataOperation when given a DataOperation', function () {
      const objToRedact = new DataOperation({ 
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      });
      const redactedClone = redact(objToRedact);
      expect(redactedClone).to.deep.equal(new DataOperation({ 
        accessToken: '<redacted>',
        sources: [],
        format: {},
        subset: {},
      }));
      // check that the original object wasn't modified
      expect(objToRedact).to.deep.equal(new DataOperation({ 
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      }));
    });

    it('returns a cloned and redacted DataOperation when the DataOperation is a property of another object', function () {
      const objToRedact = {
        nested: new DataOperation({ 
          accessToken: 'tokenToRedact',
          sources: [],
          format: {},
          subset: {},
        }),
      };
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
      expect(objToRedact).to.deep.equal({
        nested: new DataOperation({ 
          accessToken: 'tokenToRedact',
          sources: [],
          format: {},
          subset: {},
        }),
      });
    });

    it('returns a cloned and redacted DataOperation.model when given a DataOperation.model', function () {
      const objToRedact = new DataOperation({ 
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      }).model;
      const redactedClone = redact(objToRedact);
      expect(redactedClone).to.deep.equal((new DataOperation({ 
        accessToken: '<redacted>',
        sources: [],
        format: {},
        subset: {},
      })).model);
      // check that the original object wasn't modified
      expect(objToRedact).to.deep.equal((new DataOperation({ 
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      })).model);
    });
  });
});
