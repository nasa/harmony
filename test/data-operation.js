const { expect } = require('chai');
const DataOperation = require('../app/models/data-operation');

describe('DataOperation', () => {

  describe('#serialize', () => {
    describe('when its serialized JSON fails schema validation', () => {
      const operation = new DataOperation({
        callback: 'http://example.com/callback',
        sources: [],
        format: {},
        subset: { bbox: [-130, -45, 130, 45, 100] }, // bounding box has one too many numbers
      });

      describe('and its "validate" parameter is not passed', () => {
        const call = () => operation.serialize(0);

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to true', () => {
        const call = () => operation.serialize(0, true);

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to false', () => {
        const call = () => operation.serialize(0, false);

        it('does not throw an error', () => {
          expect(call).to.not.throw();
        });

        it('returns its JSON-serialized model', () => {
          expect(call()).equal('{"callback":"http://example.com/callback","sources":[],"format":{},"subset":{"bbox":[-130,-45,130,45,100]},"version":0}');
        });
      });
    });

    describe('when its serialized JSON passes schema validation', () => {
      const operation = new DataOperation({
        callback: 'http://example.com/callback',
        sources: [],
        format: {},
        subset: { bbox: [-130, -45, 130, 45] }, // Correct bounding box
      });
      const call = () => operation.serialize(0, false);

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model', () => {
        expect(call()).equal('{"callback":"http://example.com/callback","sources":[],"format":{},"subset":{"bbox":[-130,-45,130,45]},"version":0}');
      });
    });
  });
});
