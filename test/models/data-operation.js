const { expect } = require('chai');
const { describe, it } = require('mocha');
const DataOperation = require('../../app/models/data-operation');

const validOperation = new DataOperation({
  client: 'harmony-test',
  callback: 'http://example.com/callback',
  sources: [],
  format: {
    mime: 'image/png',
    interpolation: 'near',
    scaleExtent: { x: { min: 0.5, max: 125 }, y: { min: 52, max: 75.22 } },
    scaleSize: { x: 14.2, y: 35 },
    width: 120,
    height: 225,
  },
  user: 'test-user',
  subset: { bbox: [-130, -45, 130, 45] },
  isSynchronous: true,
  requestId: 'c045c793-19f1-43b5-9547-c87a5c7dfadb',
});
// Verifying that setting the temporal with dates converts them to strings
validOperation.temporal = [new Date('1999-01-01T10:00:00Z'), new Date('2020-02-20T15:00:00Z')];

const invalidOperation = new DataOperation({
  client: 'harmony-test',
  callback: 'http://example.com/callback',
  sources: [],
  format: { mime: 'image/png' },
  user: 'test-user',
  subset: { bbox: [-130, -45, 130, 45, 100] }, // bbox has one too many numbers
  isSynchronous: true,
  requestId: 'c045c793-19f1-43b5-9547-c87a5c7dfadb',
  temporal: { start: '1999-01-01T10:00:00Z', end: '2020-02-20T15:00:00Z' },
});

const expectedOutput = '{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{"mime":"image/png","interpolation":"near","scaleExtent":{"x":{"min":0.5,"max":125},"y":{"min":52,"max":75.22}},"scaleSize":{"x":14.2,"y":35},"width":120,"height":225},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"},"version":"0.5.0"}';

describe('DataOperation', () => {
  describe('#serialize', () => {
    describe('when its serialized JSON fails schema validation', () => {
      describe('and its "validate" parameter is not passed', () => {
        const call = () => invalidOperation.serialize('0.5.0');

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to true', () => {
        const call = () => invalidOperation.serialize('0.5.0', true);

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to false', () => {
        const call = () => invalidOperation.serialize('0.5.0', false);

        it('does not throw an error', () => {
          expect(call).to.not.throw();
        });

        it('returns its JSON-serialized model', () => {
          expect(call()).to.equal('{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{"mime":"image/png"},"user":"test-user","subset":{"bbox":[-130,-45,130,45,100]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"},"version":"0.5.0"}');
        });
      });
    });

    describe('when its serialized JSON passes schema validation', () => {
      const call = () => validOperation.serialize('0.5.0');

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model', () => {
        expect(call()).to.equal(expectedOutput);
      });
    });

    describe('when not specifying a schema version', () => {
      const call = () => validOperation.serialize();

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model with the latest schema version', () => {
        expect(call()).equal(expectedOutput);
      });
    });
    describe('when using the 0.4.0 schema version', () => {
      const call = () => validOperation.serialize('0.4.0');

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model without the temporal parameters and the correct 0.4.0 version', () => {
        expect(call()).equal('{"client":"harmony-test","callback":"http://example.com/callback","sources":[],"format":{"mime":"image/png","width":120,"height":225},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"},"version":"0.4.0"}');
      });
    });
  });
});
