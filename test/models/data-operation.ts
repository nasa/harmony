import { expect } from 'chai';
import { describe, it } from 'mocha';
import DataOperation from 'models/data-operation';
import { CURRENT_SCHEMA_VERSION, parseSchemaFile, versions } from 'test/helpers/data-operation';

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

  describe('#addSource', () => {
    const collection = 'Foo';
    const granules = [{
      id: 'G123-BAR',
      name: 'Gran',
      url: 'https://example.com/foo',
      temporal: {},
    }];
    const variables = [{
      meta: { 'concept-id': 'V123-BAR' },
      umm: { Name: 'the/nested/name', LongName: 'A long name' },
    }];

    describe('when adding a source', () => {
      const operation = new DataOperation();
      operation.addSource(collection, variables, granules);

      it('sets the collection correctly', () => {
        expect(operation.model.sources[0].collection).to.equal('Foo');
      });

      it('sets the granules correctly', () => {
        expect(operation.model.sources[0].granules).to.equal(granules);
      });

      it('uses the variable concept ID as the id', () => {
        expect(operation.model.sources[0].variables[0].id).to.equal('V123-BAR');
      });

      it('uses the variable name as the name', () => {
        expect(operation.model.sources[0].variables[0].name).to.equal('the/nested/name');
      });

      it('uses the variable name as the fullPath', () => {
        expect(operation.model.sources[0].variables[0].fullPath).to.equal('the/nested/name');
      });
    });
  });
});
