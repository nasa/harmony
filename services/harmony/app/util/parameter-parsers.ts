/****
 * Functions to handle query parameters
 */

import { parseBoolean } from '@harmony/util/string';

import { parseAcceptHeader } from './content-negotiation';
import parseCRS from './crs';
import { RequestValidationError } from './errors';
import { harmonyMimeTypeToName, mimeTypeAliases } from './file-formats';
import {
  ParameterParseError, parseMultiValueParameter, parseNumber,
} from './parameter-parsing-helpers';
import DataOperation from '../models/data-operation';
import HarmonyRequest from '../models/harmony-request';

/**
 * Helper function to convert parameter parsing errors into 400 errors for an end
 * user that identifies the query parameter that was a problem and the message
 * when failing to parse the parameter. If any other type of exception was thrown
 * that exception is passed through unchanged.
 *
 * @param e - the exception that was thrown
 * @param parameterName - the name of the query parameter that was being parsed
 *
 * @throws RequestValidationError if there was a specific parsing error message otherwise
 * the original exception is thrown.
 */
function convertParameterParsingError(e: Error, parameterName: string): void {
  if (e instanceof ParameterParseError) {
    throw new RequestValidationError(`parsing query parameter '${parameterName}', value ${e.message}`);
  } else {
    throw (e);
  }
}

/**
 * Handle the granuleName parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleGranuleNames(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.granulename) {
    operation.granuleNames = parseMultiValueParameter(query.granulename);
  }
}

/**
 * Handle the granuleId parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleGranuleIds(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.granuleid) {
    operation.granuleIds = parseMultiValueParameter(query.granuleid);
  }
}

/**
 * Handle the extend parameter in a Harmony query, adding it to extendDimensions in
 * the DataOperation if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleExtend(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.extend && query.extend !== 'false') {
    operation.extendDimensions = parseMultiValueParameter(query.extend);
  }
}

/**
 * Handle the ouptputCrs parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleCrs(
  operation: DataOperation,
  outputcrs: string): void {
  if (outputcrs) {
    const [crs, srs] = parseCRS(outputcrs);
    operation.crs = crs;
    operation.srs = srs;
  }
}

/**
 * Handle the scaleExtent parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleScaleExtent(
  operation: DataOperation,
  query: Record<string, number[] | string>): void {
  if (query.scaleextent) {
    try {
      let xMin, xMax, yMin, yMax;
      if (typeof query.scaleextent === 'string') {
        const scaleExtentString = query.scaleextent.replace('(', '').replace(')', '');
        [xMin, yMin, xMax, yMax] = scaleExtentString.split(/,\s*/).map(parseNumber);
      } else {
        [xMin, yMin, xMax, yMax] = query.scaleextent;
      }
      operation.scaleExtent = { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
    } catch (e) {
      convertParameterParsingError(e, 'scaleExtent');
    }
  }
}

/**
 * Handle the scaleSize parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleScaleSize(
  operation: DataOperation,
  query: Record<string, number[] | string>): void {
  if (query.scalesize) {
    try {
      let x, y;
      if (typeof query.scalesize === 'string') {
        const scaleSizeString: string = query.scalesize.replace('(', '').replace(')', '');
        [x, y] = scaleSizeString.split(/,\s*/).map(parseNumber);
      } else {
        [x, y] = query.scalesize;
      }
      operation.scaleSize = { x, y };
    } catch (e) {
      convertParameterParsingError(e, 'scaleSize');
    }
  }
}

// Allow the format to be a name from UMM-S and convert it to a mime-type.
// When comparing input from the format query parameter use all lowercase
// and no spaces to perform the lookup in a consistent way.
const harmonyNameToMimeType = Object.fromEntries(
  Object.entries(harmonyMimeTypeToName).map(([k, v]) => [v.toLowerCase().replaceAll(' ', ''), k]),
);

/**
 * Set the output format for the request. Attempts to normalize the format
 * for matching by doing the following:
 * 1. Removing quote characters from profile information
 * 2. Ignoring spaces
 * 3. Treating case insensitive by setting everything to lowercase
 * 4. Mapping known aliases to a single mime-type
 * 5. Converting accepted names from UMM-S for formats into the appropriate
 * mime-type.
 *
 * @param operation - the DataOperation for the request
 * @param format - the format string provided in the query
 * @param req - The request
 */
export function handleFormat(
  operation: DataOperation,
  format: string,
  req: HarmonyRequest): void {
  if (format) {
    let sanitizedFormat = format
      .replaceAll(' ', '')
      .replaceAll('"', '')
      .replaceAll('\'', '')
      .toLowerCase();

    sanitizedFormat = mimeTypeAliases[sanitizedFormat] ?? sanitizedFormat;
    operation.outputFormat = harmonyNameToMimeType[sanitizedFormat] ?? sanitizedFormat;
  } else if (req.headers.accept) {
    const acceptedMimeTypes = parseAcceptHeader(req.headers.accept);
    req.context.requestedMimeTypes = acceptedMimeTypes
      .map((v: { mimeType: string }) => v.mimeType)
      .filter((v) => v);
  }
}

/**
 * Handle the height parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleHeight(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.height) {
    try {
      operation.outputHeight = parseNumber(query.height);
    } catch (e) {
      convertParameterParsingError(e, 'height');
    }
  }
}

/**
 * Handle the width parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleWidth(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.width) {
    try {
      operation.outputWidth = parseNumber(query.width);
    } catch (e) {
      convertParameterParsingError(e, 'width');
    }
  }
}

/**
 * Handle the averaging parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleAveragingType(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.average) {
    const value = query.average.toLowerCase();
    if (value !== 'time' && value !== 'area') {
      throw new RequestValidationError('query parameter "average" must be either "time" or "area"');
    }
    operation.average = value;
  }
}

const booleanParameters = ['forceAsync', 'concatenate', 'skipPreview', 'ignoreErrors', 'pixelSubset'];

/**
 * Validate a boolean field has value that can be converted to boolean if present
 * Throws an error if the value is not 'true' or 'false'.
 *
 * @param field - The name of the query parameter being parsed.
 * @param value - The value to be parsed.
 * @throws RequestValidationError if the value is not 'true' or 'false'.
 */
export function validateBooleanField(field: string, value: string): void {
  if (value !== undefined) {
    const strValue = value.toString().toLowerCase();
    if (strValue !== 'true' && strValue !== 'false') {
      throw new RequestValidationError(`query parameter "${field}" must be either true or false`);
    }
  }
}

// Disable no-explicit-any for this file, since most methods will operate on objects generically
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Perform the valiation for boolean parameters to make sure
 * their values are valid strings ('true' or 'false').
 *
 * @param query - the query for the request
 * @throws RequestValidationError if any field value is not 'true' or 'false'.
 */
export function validateBooleanParameters(
  query: Record<string, any>): void {
  for (const field of booleanParameters) {
    validateBooleanField(field, query[field]);
  }
}

/**
 * Handle the forceAsync parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleForceAsync(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.forceasync !== undefined && parseBoolean(query.forceasync)) {
    operation.isSynchronous = false;
  }
}

/**
 * Handle the ignoreErrors parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handleIgnoreErrors(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.ignoreerrors === undefined) {
    operation.ignoreErrors = true;
  } else {
    operation.ignoreErrors = parseBoolean(query.ignoreerrors);
  }
}

/**
 * Handle the pixelSubset parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 */
export function handlePixelSubset(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.pixelsubset !== undefined) {
    operation.pixelSubset = parseBoolean(query.pixelsubset);
  }
}
