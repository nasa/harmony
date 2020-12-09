import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';

/**
 * Builds a schema validator for the given STAC type ('item' or 'catalog')
 * @param type - The type of validator to build ('item' or 'catalog')
 * @returns the appropriate validator for the given type
 */
export default function buildStacSchemaValidator(type: 'item' | 'catalog'): Ajv.ValidateFunction {
  const schemaNamesToSchemas: { [name: string]: object } = {};
  fs.readdirSync(path.join(__dirname, '../resources/stac-schemas')).forEach((f) => {
    const filename = path.join(__dirname, '../resources/stac-schemas', f);
    schemaNamesToSchemas[f.split('.')[0]] = JSON.parse(fs.readFileSync(filename, 'UTF-8'));
  });
  const schemaDefNames = ['basics', 'datetime', 'instrument', 'licensing', 'provider', 'Feature', 'Geometry'];
  const schemaDefs = schemaDefNames.map((f) => schemaNamesToSchemas[f]);
  const ajv = new Ajv({ schemas: schemaDefs });
  return ajv.compile(schemaNamesToSchemas[type]);
}
