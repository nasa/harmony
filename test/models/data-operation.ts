import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import DataOperation from 'models/data-operation';

const samplesDir = './test/resources/data-operation-samples';

const CURRENT_SCHEMA_VERSION = '0.8.0';

const versions = [
  '0.8.0',
  '0.7.0',
  '0.6.0',
  '0.5.0',
  '0.4.0',
];
let validOperation = JSON.parse(fs.readFileSync(path.join(samplesDir, `valid-operation-v${versions[0]}.json`)).toString());
const expectedOutput = JSON.stringify(validOperation);
validOperation = new DataOperation(validOperation);
delete validOperation.version;

validOperation.temporal = [new Date('1999-01-01T10:00:00.000Z'), new Date('2020-02-20T15:00:00.000Z')];

// bbox has one too many numbers
const invalidOperation = new DataOperation(JSON.parse(fs.readFileSync(path.join(samplesDir, 'invalid-operation.json')).toString()));

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
      const describeOldSchemaOutput = function (version, outputFile) {
        const outputJson = fs.readFileSync(path.join(samplesDir, outputFile)).toString();
        const output = JSON.stringify(JSON.parse(outputJson));
        describe(`when using the ${version} schema version`, () => {
          const call = () => validOperation.serialize(version);

          it('does not throw an error', () => {
            expect(call).to.not.throw();
          });

          it('returns its JSON-serialized model', () => {
            expect(call()).equal(output);
          });
        });
      };

      versions.forEach((version) => {
        if (version !== CURRENT_SCHEMA_VERSION) {
          describeOldSchemaOutput(
            version,
            `valid-operation-v${version}.json`,
          );
        }
      });
    });
  });
});
