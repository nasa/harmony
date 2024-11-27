/****
 * Functions to handle query parameters
 */

import DataOperation from '../models/data-operation';
import parseCRS from './crs';
import { ParameterParseError, parseMultiValueParameter, parseNumber } from './parameter-parsing-helpers';
import HarmonyRequest from '../models/harmony-request';
import { parseAcceptHeader } from './content-negotiation';
import { RequestValidationError } from './errors';
import { asyncLocalStorage } from './async-store';

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
  if (query.extend) {
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

/**
 * Set the output format for the request.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 * @param req - The request
 */
export function handleFormat(
  operation: DataOperation,
  format: string,
  req: HarmonyRequest): void {
  if (format) {
    operation.outputFormat = format;
  } else if (req.headers.accept) {
    const context = asyncLocalStorage.getStore();
    const acceptedMimeTypes = parseAcceptHeader(req.headers.accept);
    context.requestedMimeTypes = acceptedMimeTypes
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
