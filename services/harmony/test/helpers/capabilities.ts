import * as fs from 'fs';
import * as path from 'path';

import Ajv2020, { ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import request, { Test } from 'supertest';

import { hookRequest } from './hooks';
import { supportedApiVersions } from '../../app/frontends/capabilities';

/**
 * Submits a request to the collection capabilities endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param query - The query which might contain keys collectionId or shortName
 */
export function getCollectionCapabilities(app, query = {}): Test {
  return request(app).get('/capabilities').query(query);
}

export const hookGetCollectionCapabilities = hookRequest.bind(this, getCollectionCapabilities);

let _validator: Ajv2020;
// Maps the capabilities API version to the schema's $id, populated as schemas are registered
const schemaIdsByApiVersion: { [apiVersion: string]: string } = {};

/**
 * @returns a memoized Ajv instance with all of the collection capabilities schemas registered
 */
function validator(): Ajv2020 {
  if (_validator) return _validator;
  _validator = new Ajv2020({ strict: false });
  addFormats(_validator);
  for (const apiVersion of supportedApiVersions) {
    const schemaPath = path.join(
      __dirname, '..', '..', 'app', 'schemas', 'collection-capabilities', `v${apiVersion}`,
      `collection-capabilities-v${apiVersion}.json`,
    );
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    _validator.addSchema(schema);
    schemaIdsByApiVersion[apiVersion] = schema.$id;
  }
  return _validator;
}

/**
 * Asserts that the given collection capabilities response body conforms to the JSON schema for
 * the given capabilities API version.
 *
 * @param apiVersion - the collection capabilities API version ('1', '2', or '3')
 * @param capabilities - the parsed capabilities response body
 * @throws Error listing the validation errors if the response does not conform to the schema
 */
export function validateCapabilitiesSchema(apiVersion: string, capabilities: unknown): void {
  if (!supportedApiVersions.includes(apiVersion)) {
    throw new Error(`No collection capabilities schema is registered for version ${apiVersion}`);
  }
  const ajv = validator();
  const validate: ValidateFunction = ajv.getSchema(schemaIdsByApiVersion[apiVersion]);
  const valid = validate(capabilities);
  if (!valid) {
    throw new Error(
      `Capabilities response did not conform to the version ${apiVersion} schema: ${JSON.stringify(validate.errors)}`,
    );
  }
}
