import * as mustache from 'mustache';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { NextFunction } from 'express';
import DataOperation from '../models/data-operation';
import * as urlUtil from '../util/url';
import { keysToLowerCase } from '../util/object';
import { RequestValidationError, NotFoundError } from '../util/errors';
import * as services from '../models/services';
import { createDecrypter, createEncrypter } from '../util/crypto';
import { parseMultiValueParameter } from '../util/parameter-parsing';
import parseCRS from '../util/crs';
import { validateParameterNames } from '../middleware/parameter-validation';

import env from '../util/env';
import { getVariablesForCollection } from '../util/variables';

const readFile = promisify(fs.readFile);

const wmsGetMapParams = [
  'SERVICE', 'REQUEST', 'VERSION', 'LAYERS', 'CRS', 'BBOX', 'FORMAT', 'STYLES',
  'WIDTH', 'HEIGHT', 'TRANSPARENT', 'DPI', 'MAP_RESOLUTION', 'LAYERS', 'GRANULEID',
  'SKIPPREVIEW'];

/**
 * Validates that the given parameters are present in the map, throwing
 * a RequestValidationError if any are missing
 *
 * @param lowercasedParamMap - A map of all-lowercase request params to values
 * @param paramNames - Names of parameters to check
 * @returns true
 * @throws RequestValidationError - If any parameter is missing
 */
function validateParamExists(lowercasedParamMap: object, ...paramNames: string[]): boolean {
  const failures = [];

  for (const name of paramNames) {
    if (!Object.prototype.hasOwnProperty.call(lowercasedParamMap, name)) {
      failures.push(`"${name.toUpperCase()}"`);
    }
  }
  if (failures.length !== 0) {
    const message = (failures.length === 1
      ? `Query parameter ${failures.join(',')} is required`
      : `Query parameters ${failures.join(',')} are required`);
    throw new RequestValidationError(message);
  }
  return true;
}

/**
 * Validates that the given parameter has one of the values given by the values array,
 * throwing a RequestValidationError if not
 *
 * @param lowercasedParamMap - A map of all-lowercase request params to values
 * @param paramName - The name of the parameter to check
 * @param values - The list of acceptable values
 * @param allowNull - Whether a null value for the parameter should be accepted
 * @returns true
 * @throws RequestValidationError - If any parameter has an invalid value
 */
function validateParamIn(
  lowercasedParamMap: object, paramName: string, values: Array<string>, allowNull = false,
): boolean {
  const value = lowercasedParamMap[paramName];
  if (allowNull && !Object.prototype.hasOwnProperty.call(lowercasedParamMap, paramName)) {
    return true;
  }
  if (values.length === 0) {
    throw new RequestValidationError(`Query parameter "${paramName}" has no valid values`);
  }
  if (values.indexOf(value) === -1) {
    const quoted = values.map((v) => `"${v}"`).join(', ');
    const containsText = values.length === 1 ? '' : ' one of';
    throw new RequestValidationError(`Query parameter "${paramName}" must be${containsText} ${quoted}`);
  }
  return true;
}

/**
 * Returns a mustache template for the given request type, e.g. REQUEST=GetCapabilities
 *
 * @param requestParam - The WMS REQUEST parameter
 * @returns the mustache template for the given request type for WMS 1.3.0
 */
async function getWmsResponseTemplate(requestParam: string): Promise<string> {
  // TODO This could / should be cached
  const templatePath = path.join(__dirname, `templates/wms-1.3.0/${requestParam}.mustache.xml`);
  return readFile(templatePath, { encoding: 'utf8' });
}

/**
 * Renders the XML response for the given context and request type,
 * e.g. REQUEST=GetCapabilities
 *
 * @param requestParam - The WMS REQUEST parameter
 * @param context - A context object that fills in the mustache template values
 * @returns The response document
 */
async function renderToTemplate(requestParam: string, context: object): Promise<string> {
  const template = await getWmsResponseTemplate(requestParam);
  return mustache.render(template, context);
}

/**
 * Renders a JSON (TODO: XML) response to the client with status 400 containing the given message
 *
 * @param res - The response object being built for the client
 * @param message - The error message to send
 */
function requestError(res, message: string): void {
  res.status(400).json(message);
}

/**
 * Express.js-style handler that responds to WMS GetCapabilities requests.  Called when the
 * incoming request is determined to be this request type by #wmsFrontend(...).
 * Note: This does not call the next() parameter.  It returns a GetCapabilities response rather
 * than fulfilling a service request.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param _next - An unsued parameter that is included to provide the correct function
 *  signature for an Express.js handler
 * @returns Resolves when the request is complete
 */
async function getCapabilities(req, res, _next: NextFunction): Promise<void> {
  const collections = [];

  for (const collection of req.collections) {
    let bbox;
    if (collection.boxes && collection.boxes.length === 1) {
      const box = collection.boxes[0].split(' ');
      bbox = {
        south: box[0], west: box[1], north: box[2], east: box[3],
      };
    } else {
      // TODO: Coverages that are not single bounding boxes
      bbox = {
        south: -90, west: -180, north: 90, east: 180,
      };
    }
    const collectionShortLabel = `${collection.short_name} v${collection.version_id}`;
    const collectionLongLabel = `${collectionShortLabel} (${collection.archive_center || collection.data_center})`;

    const collectionData = {
      name: undefined,
      bbox,
      label: collectionLongLabel,
      variables: [],
    };

    for (const variable of collection.variables) {
      collectionData.variables.push({
        name: `${collection.id}/${variable.meta['concept-id']}`,
        description: `${variable.umm.LongName}\n${collectionLongLabel}\n\n${collection.summary}`,
        label: `${variable.umm.Name} (${variable.umm.LongName})`,
        bbox,
      });
    }
    if (collectionData.variables.length === 0) {
      collectionData.name = collection.id;
    }
    collections.push(collectionData);
  }

  const capabilities = {
    url: urlUtil.getRequestUrl(req, false),
    collections,
  };

  res.status(200);
  res.set('Content-Type', 'text/xml');
  res.send(await renderToTemplate('GetCapabilities', capabilities));
}

/**
 * Express.js-style handler that handles calls to WMS GetMap requests
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the chain
 */
function getMap(req, res, next: NextFunction): void {
  // http://portal.opengeospatial.org/files/?artifact_id=14416
  // Section 7.3

  const query = req.wmsQuery;

  // Required WMS params
  validateParamExists(query,
    'layers',
    'crs',
    'bbox',
    'format',
    'styles',
    'width',
    'height');

  validateParamIn(query, 'transparent', ['TRUE', 'FALSE']);

  validateParameterNames(Object.keys(req.query), wmsGetMapParams);

  const dpi = query.dpi || query.map_resolution;

  const encrypter = createEncrypter(env.sharedSecretKey);
  const decrypter = createDecrypter(env.sharedSecretKey);
  const operation = new DataOperation(null, encrypter, decrypter);

  const varInfos = getVariablesForCollection(query.layers, req.collections);
  for (const varInfo of varInfos) {
    operation.addSource(varInfo.collectionId, varInfo.variables, varInfo.coordinateVariables);
  }

  const [crs, srs] = parseCRS({ queryCRS_: query.crs, validate: false });
  operation.crs = crs || query.crs;
  operation.srs = srs;

  operation.isTransparent = query.transparent === 'TRUE';
  if (query.format) {
    operation.outputFormat = query.format;
  }
  operation.outputWidth = parseInt(query.width, 10);
  operation.outputHeight = parseInt(query.height, 10);
  if (dpi) {
    operation.outputDpi = parseInt(dpi, 10);
  }

  const [west, south, east, north] = query.bbox.split(',').map((c) => parseFloat(c));
  operation.boundingRectangle = [west, south, east, north];

  if (query.granuleid) {
    // NOTE: we will allow a user to pass in a comma-separated list of granule IDs;
    // however, only the first granule returned by CMR is used when performing the
    // service request.
    operation.granuleIds = parseMultiValueParameter(query.granuleid);
  }

  // WMS requests only support synchronous execution
  operation.requireSynchronous = true;
  req.operation = operation;
  next();
}

/**
 * Express.js handler that handles calls to the WMS endpoint
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the chain
 */
export default async function wmsFrontend(req, res, next: NextFunction): Promise<void> {
  req.context.frontend = 'wms';
  const query = keysToLowerCase(req.query);
  req.wmsQuery = query;

  try {
    validateParamIn(query, 'service', ['WMS']);
    validateParamIn(query, 'request', ['GetCapabilities', 'GetMap']);
    if (!req.collections.every(services.isCollectionSupported)) {
      throw new NotFoundError('There is no service configured to support transformations on the provided collection via WMS.');
    }

    const wmsRequest = query.request;
    if (wmsRequest === 'GetCapabilities') {
      return await getCapabilities(req, res, next);
    }
    if (wmsRequest === 'GetMap') {
      validateParamIn(query, 'version', ['1.3.0']);
      return getMap(req, res, next);
    }
    throw new Error(`Unrecognized operation: ${wmsRequest}`);
  } catch (e) {
    // TODO: Handle 'exceptions' param (HARMONY-40)
    if (e instanceof RequestValidationError) {
      req.context.logger.error(e.message);
      return requestError(res, e.message);
    }

    throw e;
  }
}
