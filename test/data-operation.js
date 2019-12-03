const { expect } = require('chai');
const { describe, it } = require('mocha');
const DataOperation = require('../app/models/data-operation');

describe('DataOperation', () => {
  describe('#serialize', () => {
    describe('when its serialized JSON fails schema validation', () => {
      const operation = new DataOperation({
        client: 'harmony-test',
        callback: 'http://example.com/callback',
        sources: [],
        format: {},
        subset: { bbox: [-130, -45, 130, 45, 100] }, // bounding box has one too many numbers
        version: '0.2.0',
      });

      describe('and its "validate" parameter is not passed', () => {
        const call = () => operation.serialize();

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to true', () => {
        const call = () => operation.serialize(true);

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to false', () => {
        const call = () => operation.serialize(false);

        it('does not throw an error', () => {
          expect(call).to.not.throw();
        });

        it('returns its JSON-serialized model', () => {
          expect(call()).equal('{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{},"subset":{"bbox":[-130,-45,130,45,100]},"version":"0.2.0"}');
        });
      });
    });

    describe('when its serialized JSON passes schema validation', () => {
      const operation = new DataOperation({
        client: 'harmony-test',
        callback: 'http://example.com/callback',
        sources: [],
        format: {},
        subset: { bbox: [-130, -45, 130, 45] }, // Correct bounding box
        version: '0.2.0',
      });
      const call = () => operation.serialize(false);

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model', () => {
        expect(call()).equal('{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{},"subset":{"bbox":[-130,-45,130,45]},"version":"0.2.0"}');
      });
    });

    describe('when using the 0.1.0 schema version', () => {
      const operation = new DataOperation({
        client: 'harmony-test',
        callback: 'http://example.com/callback',
        sources: [],
        format: {},
        subset: { bbox: [-130, -45, 130, 45] },
        version: '0.1.0',
      });
      const call = () => operation.serialize(false);

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model without the client parameter and the correct 0.1.0 version', () => {
        expect(call()).equal('{"callback":"http://example.com/callback","sources":[],"format":{},"subset":{"bbox":[-130,-45,130,45]},"version":"0.1.0"}');
      });
    });
  });
});
