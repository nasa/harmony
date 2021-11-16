import fs from 'fs';
import path from 'path';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

/**
 * Builds a schema validator for the given STAC type ('item' or 'catalog')
 * @param type - The type of validator to build ('item' or 'catalog')
 * @returns the appropriate validator for the given type
 */
export default function buildStacSchemaValidator(type: 'item' | 'catalog'): ValidateFunction {
  const schemaNamesToSchemas: { [name: string]: object } = {};
  fs.readdirSync(path.join(__dirname, '../resources/stac-schemas')).forEach((f) => {
    const filename = path.join(__dirname, '../resources/stac-schemas', f);
    schemaNamesToSchemas[f.split('.')[0]] = JSON.parse(fs.readFileSync(filename, 'utf8'));
  });
  const schemaDefNames = ['basics', 'datetime', 'instrument', 'licensing', 'provider', 'Feature', 'Geometry'];
  const schemaDefs = schemaDefNames.map((f) => schemaNamesToSchemas[f]);
  const ajv = new Ajv({ schemas: schemaDefs });
  addFormats(ajv);
  return ajv.compile(schemaNamesToSchemas[type]);
}
