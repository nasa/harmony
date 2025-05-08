import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

import DataOperation from '../../app/models/data-operation';

export const samplesDir = './test/resources/data-operation-samples';

export const versions = [
  '0.22.0',
  '0.21.0',
  '0.20.0',
  '0.19.0',
  '0.18.0',
  '0.17.0',
  '0.16.0',
  '0.15.0',
  '0.14.0',
  '0.13.0',
  '0.12.0',
  '0.11.0',
  '0.10.0',
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
 * @param filename - The filename in the schemas directory to read
 * @returns the parsed JSON
 */
export function parseSchemaFile(
  filename: string = null,
): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  return JSON.parse(fs.readFileSync(path.join(samplesDir, filename)).toString());
}

/**
 * Build an operation for testing.
 * @returns DataOperation
 */
export function buildOperation(message: string): DataOperation {
  const operation = new DataOperation();
  operation.requestId = uuid().toString();
  operation.user = 'Bo';
  operation.granuleIds = ['g1'];
  operation.granuleNames = ['g1foo'];
  operation.requireSynchronous = false;
  operation.maxResults = 10;
  operation.cmrHits = 100;
  operation.scrollIDs = [];
  operation.cmrQueryLocations = [];
  operation.message = message;
  operation.requestStartTime = new Date();
  operation.ignoreErrors = true;
  operation.accessToken = 'mytoken';
  operation.client = 'test';
  return operation;
}