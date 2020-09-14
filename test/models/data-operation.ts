import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import DataOperation from 'models/data-operation';

const samplesDir = './test/resources/data-operation-samples';

const CURRENT_SCHEMA_VERSION = '0.9.0';

const versions = [
  '0.9.0',
  '0.8.0',
  '0.7.0',
  '0.6.0',
  '0.5.0',
  '0.4.0',
];

/**
 * Reads and parses a file in the schemas directory as JSON
 *
 * @param filename The filename in the schemas directory to read
 * @returns the parsed JSON
 */
function parseSchemaFile(
  filename: string = null,
): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  return JSON.parse(fs.readFileSync(path.join(samplesDir, filename)).toString());
}

const validOperation = new DataOperation(parseSchemaFile('valid-operation-input.json'));
// bbox has one too many numbers
const invalidOperation = new DataOperation(parseSchemaFile('invalid-operation-input.json'));

describe('DataOperation', () => {
  describe('#serialize', () => {
    describe('when its serialized JSON fails schema validation', () => {
      const call = (): string => invalidOperation.serialize(CURRENT_SCHEMA_VERSION);

      it('throws an error', () => {
        expect(call).to.throw(TypeError);
      });
    });

    describe('when its serialized JSON passes schema validation', () => {
      const call = (): string => validOperation.serialize(CURRENT_SCHEMA_VERSION);

      it('does not throw an error', () => {
        expect(call).to.not.throw();
      });

      it('returns its JSON-serialized model', () => {
        const expectedOutput = parseSchemaFile(`valid-operation-v${versions[0]}.json`);
        expect(JSON.parse(call())).to.eql(expectedOutput);
      });
    });

    describe('when not specifying a schema version', () => {
      const call = (): string => validOperation.serialize(null);

      it('throws an error', () => {
        expect(call).to.throw(TypeError);
      });
    });

    describe('when specifying a schema version that cannot be serialized', () => {
      const call = (): string => validOperation.serialize('0.1.0');

      it('throws an error', () => {
        expect(call).to.throw(RangeError);
      });
    });

    describe('specifying a URL pattern', () => {
      describe('when URLs match the provided pattern', () => {
        const call = (): string => validOperation.serialize(CURRENT_SCHEMA_VERSION, 'opendap\\..*\\.example');

        it('returns the first data URL matching the provided regex pattern', function () {
          const result = JSON.parse(call());
          expect(result.sources[0].granules[0].url).to.equal('http://opendap.one.example.com');
        });
      });

      describe('when no URLs match the provided pattern', () => {
        const call = (): string => validOperation.serialize(CURRENT_SCHEMA_VERSION, 'closedap');

        it('throws an error', () => {
          expect(call).to.throw(TypeError);
        });
      });
    });

    describe('specifying no URL pattern', () => {
      const call = (): string => validOperation.serialize(CURRENT_SCHEMA_VERSION, null);

      it('returns the first data URL', function () {
        const result = JSON.parse(call());
        expect(result.sources[0].granules[0].url).to.equal('http://example.com');
      });
    });

    describe('serializing to older schema versions', () => {
      const describeOldSchemaOutput = function (version, outputFile): void {
        const output = parseSchemaFile(outputFile);
        describe(`when using the ${version} schema version`, () => {
          const call = (): string => validOperation.serialize(version);

          it('does not throw an error', () => {
            expect(call).to.not.throw();
          });

          it('returns its JSON-serialized model', () => {
            expect(JSON.parse(call())).eql(output);
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
