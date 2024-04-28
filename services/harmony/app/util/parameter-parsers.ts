/****
 * Functions to handle query parameters
 */

import DataOperation from '../models/data-operation';
import parseCRS from './crs';
import { parseMultiValueParameter, parseNumber } from './parameter-parsing-helpers';
import HarmonyRequest from '../models/harmony-request';
import { parseAcceptHeader } from './content-negotiation';

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
  query: Record<string, string>): void {
  if (query.outputcrs) {
    const [crs, srs] = parseCRS(query.outputcrs);
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
  query: Record<string, number[]>): void;
export function handleScaleExtent(
  operation: DataOperation,
  query: Record<string, string>): void;
export function handleScaleExtent(
  operation: DataOperation,
  query: Record<string, number[] | string>): void {
  if (query.scaleextent) {
    if (typeof query.scaleextent === 'string') {
      const scaleExtentString = query.scaleextent.replace('(', '').replace(')', '');
      const [xMinString, yMinString, xMaxString, yMaxString] = scaleExtentString.split(/,\s*/);
      operation.scaleExtent = {
        x: { min: parseNumber(xMinString), max: parseNumber(xMaxString) },
        y: { min: parseNumber(yMinString), max: parseNumber(yMaxString) },
      };
    } else {
      const [xMin, yMin, xMax, yMax] = query.scaleextent;
      operation.scaleExtent = { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
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
  query: Record<string, number[]>): void;
export function handleScaleSize(
  operation: DataOperation,
  query: Record<string, string>): void;
export function handleScaleSize(
  operation: DataOperation,
  query: Record<string, number[] | string>): void {
  if (query.scalesize) {
    if (typeof query.scalesize === 'string') {
      const scaleSizeString: string = query.scalesize.replace('(', '').replace(')', '');
      const [xString, yString] = scaleSizeString.split(/,\s*/);
      operation.scaleSize = { x: parseNumber(xString), y: parseNumber(yString) };
    } else {
      const [x, y] = query.scalesize;
      operation.scaleSize = { x, y };
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
  query: Record<string, string>,
  req: HarmonyRequest): void {
  if (query.format) {
    operation.outputFormat = query.format;
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
 * @param req - the request
 */
export function handleHeight(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.height) {
    operation.outputHeight = parseNumber(query.height);
  }
}

/**
 * Handle the width parameter in a Harmony query, adding it to the DataOperation
 * if necessary.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 * @param req - the request
 */
export function handleWidth(
  operation: DataOperation,
  query: Record<string, string>): void {
  if (query.width) {
    operation.outputWidth = parseNumber(query.width);
  }
}
