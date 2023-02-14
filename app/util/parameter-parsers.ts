/****
 * Functions to handle query parameters
 */

import DataOperation from '../models/data-operation';
import parseCRS from './crs';
import { parseMultiValueParameter } from './parameter-parsing-helpers';
import HarmonyRequest from '../models/harmony-request';
import { parseAcceptHeader } from './content-negotiation';
// import { parseGrid } from './grids';

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
  query: Record<string, string>): void {
  if (query.scaleextent) {
    const [xMin, yMin, xMax, yMax] = query.scaleextent;
    operation.scaleExtent = { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
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
  query: Record<string, number[]>): void {
  if (query.scalesize) {
    const [x, y] = query.scalesize;
    operation.scaleSize = { x, y };
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

// /**
//  * Handle the scaleSize parameter in a Harmony query, adding it to the DataOperation
//  * if necessary.
//  *
//  * @param operation - the DataOperation for the request
//  * @param query - the query for the request
//  */
// export async function handleGrid(
//   operation: DataOperation,
//   query: Record<string, string>,
//   req: HarmonyRequest): Promise<void> {
//   if (query.grid) {
//     await parseGrid(operation, query, req);
//   }
// }