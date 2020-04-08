const { expect } = require('chai');
const { describe, it } = require('mocha');
const fs = require('fs');
const DataOperation = require('../../app/models/data-operation');

const CURRENT_SCHEMA_VERSION = '0.7.0';

const validOperationJson = fs.readFileSync('./test/resources/data-operation-samples/valid-operation.json');
const validOperation = new DataOperation(JSON.parse(validOperationJson));
validOperation.temporal = [new Date('1999-01-01T10:00:00Z'), new Date('2020-02-20T15:00:00Z')];

// bbox has one too many numbers
const invalidOperationJson = fs.readFileSync('./test/resources/data-operation-samples/invalid-operation.json');
const invalidOperation = new DataOperation(JSON.parse(invalidOperationJson));

const expectedOutput = `{"client":"harmony-test","callback":"http://example.com/callback","stagingLocation":"s3://some-bucket/public/some/prefix/","sources":[{"collection":"C1233800302-EEDTEST","granules":[{"id":"G1233800343-EEDTEST","name":"001_00_7f00ff_global.nc","url":"http://example.com","bbox":[-100.5,30.4,-99.5,31.4],"temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"}}]}],"format":{"mime":"image/png","interpolation":"near","scaleExtent":{"x":{"min":0.5,"max":125},"y":{"min":52,"max":75.22}},"scaleSize":{"x":14.2,"y":35},"width":120,"height":225},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"},"version":"${CURRENT_SCHEMA_VERSION}"}`;

describe('DataOperation', () => {
  describe('#serialize', () => {
    describe('when its serialized JSON fails schema validation', () => {
      describe('and its "validate" parameter is not passed', () => {
        const call = () => invalidOperation.serialize(CURRENT_SCHEMA_VERSION);

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to true', () => {
        const call = () => invalidOperation.serialize(CURRENT_SCHEMA_VERSION, true);

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });

      describe('and its "validate" parameter is set to false', () => {
        const call = () => invalidOperation.serialize(CURRENT_SCHEMA_VERSION, false);

        it('does not throw an error', () => {
          expect(call).to.not.throw();
        });

        it('returns its JSON-serialized model', () => {
          expect(call()).to.equal(`{"client":"harmony-test","callback":"http://example.com/callback","stagingLocation":"s3://some-bucket/public/some/prefix/","sources":[],"format":{"mime":"image/png"},"user":"test-user","subset":{"bbox":[-130,-45,130,45,100]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"},"version":"${CURRENT_SCHEMA_VERSION}"}`);
        });
      });
    });

    describe('when its serialized JSON passes schema validation', () => {
      const call = () => validOperation.serialize(CURRENT_SCHEMA_VERSION);

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model', () => {
        expect(call()).to.equal(expectedOutput);
      });
    });

    describe('when not specifying a schema version', () => {
      const call = () => validOperation.serialize();

      it('throws an error', () => {
        expect(call).to.throw(TypeError);
      });
    });

    describe('when specifying a schema version that cannot be serialized', () => {
      const call = () => validOperation.serialize('0.1.0');

      it('throws an error', () => {
        expect(call).to.throw(RangeError);
      });
    });

    describe('serializing to older schema versions', () => {
      const describeOldSchemaOutput = function (version, description, output) {
        describe(`when using the ${version} schema version`, () => {
          const call = () => validOperation.serialize(version);

          it('does not throw an error', () => {
            expect(call).to.not.throw();
          });

          it(`returns its JSON-serialized model ${description}`, () => {
            expect(call()).equal(output);
          });
        });
      };

      describeOldSchemaOutput(
        '0.6.0',
        'without granule bbox or temporal',
        '{"client":"harmony-test","callback":"http://example.com/callback","stagingLocation":"s3://some-bucket/public/some/prefix/","sources":[{"collection":"C1233800302-EEDTEST","granules":[{"id":"G1233800343-EEDTEST","name":"001_00_7f00ff_global.nc","url":"http://example.com"}]}],"format":{"mime":"image/png","interpolation":"near","scaleExtent":{"x":{"min":0.5,"max":125},"y":{"min":52,"max":75.22}},"scaleSize":{"x":14.2,"y":35},"width":120,"height":225},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"},"version":"0.6.0"}',
      );

      describeOldSchemaOutput(
        '0.5.0',
        'without shapefile locations',
        '{"client":"harmony-test","callback":"http://example.com/callback","sources":[{"collection":"C1233800302-EEDTEST","granules":[{"id":"G1233800343-EEDTEST","name":"001_00_7f00ff_global.nc","url":"http://example.com"}]}],"format":{"mime":"image/png","interpolation":"near","scaleExtent":{"x":{"min":0.5,"max":125},"y":{"min":52,"max":75.22}},"scaleSize":{"x":14.2,"y":35},"width":120,"height":225},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"},"version":"0.5.0"}',
      );

      describeOldSchemaOutput(
        '0.4.0',
        'without temporal parameters',
        '{"client":"harmony-test","callback":"http://example.com/callback","sources":[{"collection":"C1233800302-EEDTEST","granules":[{"id":"G1233800343-EEDTEST","name":"001_00_7f00ff_global.nc","url":"http://example.com"}]}],"format":{"mime":"image/png","width":120,"height":225},"user":"test-user","subset":{"bbox":[-130,-45,130,45]},"isSynchronous":true,"requestId":"c045c793-19f1-43b5-9547-c87a5c7dfadb","temporal":{"start":"1999-01-01T10:00:00Z","end":"2020-02-20T15:00:00Z"},"version":"0.4.0"}',
      );
    });
  });
});
