import { expect } from 'chai';
import { describe, it } from 'mocha';
import { parseSchemaFile, versions } from '../helpers/data-operation';
import DataOperation, { CURRENT_SCHEMA_VERSION } from '../../app/models/data-operation';
import { CmrRelatedUrl } from '../../app/util/cmr';

const validOperation = new DataOperation(parseSchemaFile('valid-operation-input.json'));
// bbox has one too many numbers
const invalidOperation = new DataOperation(parseSchemaFile('invalid-operation-input.json'));
const expectedOutput = parseSchemaFile(`valid-operation-v${versions[0]}.json`);
// The fields that all operations should contain
const baseFields = new Set([
  'client', 'callback', 'stagingLocation', 'sources', 'format', 'user', 'accessToken',
  'subset', 'isSynchronous', 'requestId', 'temporal', 'version', 'concatenate',
]);

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

    describe('when specifying fields to include', () => {
      describe('reproject', () => {
        const serializedOperation = validOperation.serialize(CURRENT_SCHEMA_VERSION, ['reproject']);

        it('includes reprojection fields for the operation', () => {
          const parsedOperation = JSON.parse(serializedOperation);
          expect(parsedOperation.format.crs).to.eql('CRS84');
          expect(parsedOperation.format.srs).to.eql(expectedOutput.format.srs);
        });

        it('does not include reformatting fields for the operation', () => {
          expect(JSON.parse(serializedOperation).format.mime).to.be.undefined;
        });

        it('does not include variables for the operation', () => {
          expect(JSON.parse(serializedOperation).sources[0].variables).to.be.undefined;
        });

        it('includes all of the base fields for the operation', () => {
          expect(new Set(Object.keys(JSON.parse(serializedOperation)))).to.eql(baseFields);
        });
      });

      describe('reformat', () => {
        const serializedOperation = validOperation.serialize(CURRENT_SCHEMA_VERSION, ['reformat']);

        it('does not include reprojection fields for the operation', () => {
          const parsedOperation = JSON.parse(serializedOperation);
          expect(parsedOperation.format.crs).to.be.undefined;
          expect(parsedOperation.format.srs).to.be.undefined;
        });

        it('includes reformatting fields for the operation', () => {
          expect(JSON.parse(serializedOperation).format.mime).to.equal('image/png');
        });

        it('does not include variables for the operation', () => {
          expect(JSON.parse(serializedOperation).sources[0].variables).to.be.undefined;
        });

        it('includes all of the base fields for the operation', () => {
          expect(new Set(Object.keys(JSON.parse(serializedOperation)))).to.eql(baseFields);
        });
      });

      describe('variableSubset', () => {
        const serializedOperation = validOperation.serialize(CURRENT_SCHEMA_VERSION, ['variableSubset']);

        it('does not include reprojection fields for the operation', () => {
          const parsedOperation = JSON.parse(serializedOperation);
          expect(parsedOperation.format.crs).to.be.undefined;
          expect(parsedOperation.format.srs).to.be.undefined;
        });

        it('does not include reformatting fields for the operation', () => {
          expect(JSON.parse(serializedOperation).format.mime).to.be.undefined;
        });

        it('includes variables for the operation', () => {
          expect(JSON.parse(serializedOperation).sources[0].variables).to.eql(expectedOutput.sources[0].variables);
        });

        it('includes all of the base fields for the operation', () => {
          expect(new Set(Object.keys(JSON.parse(serializedOperation)))).to.eql(baseFields);
        });
      });

      describe('spatialSubset', () => {
        const serializedOperation = validOperation.serialize(CURRENT_SCHEMA_VERSION, ['spatialSubset']);

        it('includes the bbox subset for the operation', () => {
          expect(JSON.parse(serializedOperation).subset.bbox).to.eql(expectedOutput.subset.bbox);
        });

        it('does not include reprojection fields for the operation', () => {
          const parsedOperation = JSON.parse(serializedOperation);
          expect(parsedOperation.format.crs).to.be.undefined;
          expect(parsedOperation.format.srs).to.be.undefined;
        });

        it('does not include reformatting fields for the operation', () => {
          expect(JSON.parse(serializedOperation).format.mime).to.be.undefined;
        });

        it('does not include variables for the operation', () => {
          expect(JSON.parse(serializedOperation).sources[0].variables).to.be.undefined;
        });

        it('includes all of the base fields for the operation and the subset field', () => {
          expect(new Set(Object.keys(JSON.parse(serializedOperation)))).to.eql(new Set(baseFields.add('subset')) );
        });
      });

      describe('shapefileSubset', () => {
        const serializedOperation = validOperation.serialize(CURRENT_SCHEMA_VERSION, ['shapefileSubset']);

        it('includes the shapefile subset for the operation', () => {
          expect(JSON.parse(serializedOperation).subset.shape).to.eql(expectedOutput.subset.shape);
        });

        it('does not include reprojection fields for the operation', () => {
          const parsedOperation = JSON.parse(serializedOperation);
          expect(parsedOperation.format.crs).to.be.undefined;
          expect(parsedOperation.format.srs).to.be.undefined;
        });

        it('does not include reformatting fields for the operation', () => {
          expect(JSON.parse(serializedOperation).format.mime).to.be.undefined;
        });

        it('does not include variables for the operation', () => {
          expect(JSON.parse(serializedOperation).sources[0].variables).to.be.undefined;
        });

        it('includes all of the base fields for the operation and the subset field', () => {
          expect(new Set(Object.keys(JSON.parse(serializedOperation)))).to.eql(new Set(baseFields.add('subset')) );
        });
      });

      describe('spatialSubset and variableSubset', () => {
        const serializedOperation = validOperation.serialize(CURRENT_SCHEMA_VERSION, ['spatialSubset', 'variableSubset']);

        it('includes the bbox subset for the operation', () => {
          expect(JSON.parse(serializedOperation).subset.bbox).to.eql(expectedOutput.subset.bbox);
        });

        it('does not include reprojection fields for the operation', () => {
          const parsedOperation = JSON.parse(serializedOperation);
          expect(parsedOperation.format.crs).to.be.undefined;
          expect(parsedOperation.format.srs).to.be.undefined;
        });

        it('does not include reformatting fields for the operation', () => {
          expect(JSON.parse(serializedOperation).format.mime).to.be.undefined;
        });

        it('includes variables for the operation', () => {
          expect(JSON.parse(serializedOperation).sources[0].variables).to.eql(expectedOutput.sources[0].variables);
        });

        it('includes all of the base fields for the operation and the subset field', () => {
          expect(new Set(Object.keys(JSON.parse(serializedOperation)))).to.eql(new Set(baseFields.add('subset')) );
        });
      });

      describe('all fields requested', () => {
        const serializedOperation = validOperation.serialize(
          CURRENT_SCHEMA_VERSION, ['spatialSubset', 'variableSubset', 'reformat', 'reproject', 'shapefileSubset', 'dimensionSubset'],
        );

        it('includes all of the fields for the operation', () => {
          expect(JSON.parse(serializedOperation)).to.eql(expectedOutput);
        });
      });

    });
  });

  describe('#addSource', () => {
    const collection = 'Foo';
    const shortName = 'harmony_example';
    const versionId = '1';
    const relatedUrls = [
      {
        Description: 'This related URL points to a color map',
        URLContentType: 'VisualizationURL',
        Type: 'Color Map',
        Subtype: 'Harmony GDAL',
        URL: 'https://example.com/colormap123.txt',
        MimeType: 'text/plain',
        Format: 'ASCII',
      },
      {
        Description: 'This related URL points to some data',
        URLContentType: 'DistributionURL',
        Type: 'GET DATA',
        Subtype: 'EOSDIS DATA POOL',
        URL: 'https://example.com/colormap123.nc4',
        MimeType: 'text/plain',
        Format: 'ASCII',
      },
      {
        Description: 'Related URL',
        Subtype: 'EOSDIS DATA POOL',
        URL: 'https://example.com/colormap123.nc4',
        MimeType: 'text/plain',
        Format: 'ASCII',
      } as CmrRelatedUrl,
    ];
    const variables = [{
      meta: { 'concept-id': 'V123-BAR' },
      umm: {
        Name: 'the/nested/name',
        LongName: 'A long name',
        RelatedURLs: relatedUrls,
        VariableType: 'SCIENCE_VARIABLE',
        VariableSubType: 'SCIENCE_VECTOR',
      },
    }];

    const coordinateVariables = [{
      meta: { 'concept-id': 'V124-BAR' },
      umm: {
        Name: 'lat',
        LongName: 'A long name for latitude',
        VariableType: 'COORDINATE',
        VariableSubType: 'LATITUDE',
      },
    }];

    describe('when adding a source', () => {
      const operation = new DataOperation();
      operation.addSource(collection, shortName, versionId, variables, coordinateVariables);

      it('sets the collection correctly', () => {
        expect(operation.model.sources[0].collection).to.equal('Foo');
      });

      it('sets the short name correctly', () => {
        expect(operation.model.sources[0].shortName).to.equal('harmony_example');
      });

      it('sets the version id correctly', () => {
        expect(operation.model.sources[0].versionId).to.equal('1');
      });

      it('sets the coordinate variables correctly', () => {
        expect(operation.model.sources[0].coordinateVariables).to.eql([{
          id: 'V124-BAR',
          name: 'lat',
          fullPath: 'lat',
          type: 'COORDINATE',
          subtype: 'LATITUDE',
        }]);
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

      it('sets the Color Map related URL', () => {
        expect(operation.model.sources[0].variables[0].relatedUrls[0]).to.deep.equal(
          {
            description: 'This related URL points to a color map',
            urlContentType: 'VisualizationURL',
            type: 'Color Map',
            subtype: 'Harmony GDAL',
            url: 'https://example.com/colormap123.txt',
            mimeType: 'text/plain',
            format: 'ASCII',
          },
        );
        expect(operation.model.sources[0].variables[0].relatedUrls[1]).to.deep.equal(
          {
            description: 'This related URL points to some data',
            urlContentType: 'DistributionURL',
            type: 'GET DATA',
            subtype: 'EOSDIS DATA POOL',
            url: 'https://example.com/colormap123.nc4',
            mimeType: 'text/plain',
            format: 'ASCII',
          },
        );
        expect(operation.model.sources[0].variables[0].relatedUrls[2]).to.deep.equal(
          {
            description: 'Related URL',
            urlContentType: undefined,
            type: undefined,
            subtype: 'EOSDIS DATA POOL',
            url: 'https://example.com/colormap123.nc4',
            mimeType: 'text/plain',
            format: 'ASCII',
          },
        );
        expect(operation.model.sources[0].variables[0].relatedUrls.length).length.to.equal(3);
      });
    });
  });
});
