const { expect } = require('chai');
const { describe, it } = require('mocha');
const DataOperation = require('../app/models/data-operation');

const validOperation = new DataOperation({
  client: 'harmony-test',
  callback: 'http://example.com/callback',
  sources: [],
  format: {},
  user: 'test-user',
  subset: { bbox: [-130, -45, 130, 45] },
  isSynchronous: true,
  requestId: 'c045c793-19f1-43b5-9547-c87a5c7dfadb',
});

const invalidOperation = new DataOperation({
  client: 'harmony-test',
  callback: 'http://example.com/callback',
  sources: [],
  format: {},
  user: 'test-user',
  subset: { bbox: [-130, -45, 130, 45, 100] }, // bbox has one too many numbers
  isSynchronous: true,
  requestId: 'c045c793-19f1-43b5-9547-c87a5c7dfadb',
});

describe('DataOperation', () => {
  describe('#serialize', () => {
    describe('when its serialized JSON fails schema validation', () => {
      describe('and its "validate" parameter is not passed', () => {
        const call = () => invalidOperation.serialize('0.3.0');

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to true', () => {
        const call = () => invalidOperation.serialize('0.3.0', true);

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to false', () => {
        const call = () => invalidOperation.serialize('0.3.0', false);

        it('does not throw an error', () => {
          expect(call).to.not.throw();
        });

        it('returns its JSON-serialized model', () => {
          expect(call()).equal('{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{},"user":"test-user","subset":{"bbox":[-130,-45,130,45,100]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","version":"0.3.0"}');
        });
      });
    });

    describe('when its serialized JSON passes schema validation', () => {
      const call = () => validOperation.serialize('0.3.0');

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model', () => {
        expect(call()).equal('{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","version":"0.3.0"}');
      });
    });

    describe('when not specifying a schema version', () => {
      const call = () => validOperation.serialize();

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model with the latest schema version', () => {
        expect(call()).equal('{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","version":"0.3.0"}');
      });
    });
    describe('when using the 0.2.0 schema version', () => {
      const call = () => validOperation.serialize('0.2.0');

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model without the isSynchronous and requestId parameters and the correct 0.2.0 version', () => {
        expect(call()).equal('{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"version":"0.2.0"}');
      });
    });
  });
});
