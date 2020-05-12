import * as mustache from 'mustache';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import DataOperation from 'models/data-operation';
import * as urlUtil from 'util/url';
import keysToLowerCase from 'util/object';
import { RequestValidationError, NotFoundError } from 'util/errors';
import * as services from 'models/services';

const readFile = promisify(fs.readFile);


/**
 * Validates that the given parameters are present in the map, throwing
 * a RequestValidationError if any are missing
 *
 * @param {object} lowercasedParamMap A map of all-lowercase request params to values
 * @param  {...string} paramNames Names of parameters to check
 * @returns {boolean} true
 * @throws {RequestValidationError} If any parameter is missing
 */
function validateParamExists(lowercasedParamMap, ...paramNames) {
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
 * @param {object} lowercasedParamMap A map of all-lowercase request params to values
 * @param {string} paramName The name of the parameter to check
 * @param {Array<string>} values The list of acceptable values
 * @param {boolean} allowNull Whether a null value for the parameter should be accepted
 * @returns {boolean} true
 * @throws {RequestValidationError} If any parameter has an invalid value
 */
function validateParamIn(lowercasedParamMap, paramName, values, allowNull = false) {
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
 * @param {string} requestParam The WMS REQUEST parameter
 * @returns {string} the mustache template for the given request type for WMS 1.3.0
 */
async function getWmsResponseTemplate(requestParam) {
  // TODO This could / should be cached
  const templatePath = path.join(__dirname, `templates/wms-1.3.0/${requestParam}.mustache.xml`);
  return readFile(templatePath, { encoding: 'utf8' });
}

/**
 * Renders the XML response for the given context and request type,
 * e.g. REQUEST=GetCapabilities
 *
 * @param {string} requestParam The WMS REQUEST parameter
 * @param {object} context A context object that fills in the mustache template values
 * @returns{string} The response document
 */
async function renderToTemplate(requestParam, context) {
  const template = await getWmsResponseTemplate(requestParam);
  return mustache.render(template, context);
}

/**
 * Renders a JSON (TODO: XML) response to the client with status 400 containing the given message
 *
 * @param {http.ServerResponse} res The response object being built for the client
 * @param {string} message The error message to send
 * @returns {void}
 */
function requestError(res, message) {
  res.status(400).json(message);
}

/**
 * Express.js-style handler that responds to WMS GetCapabilities requests.  Called when the
 * incoming request is determined to be this request type by #wmsFrontend(...).
 * Note: This does not call the next() parameter.  It returns a GetCapabilities response rather
 * than fulfilling a service request.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {Function} _next An unsued parameter that is included to provide the correct function
 *  signature for an Express.js handler
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getCapabilities(req, res, _next) {
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

    const collectionData: any = {
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
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {function} next The next function in the chain
 * @returns {void}
 */
function getMap(req, res, next) {
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

  const dpi = query.dpi || query.map_resolution;

  const operation = new DataOperation();

  const variablesByCollection = {};
  const collectionVariables = query.layers.split(',');
  for (const collectionVariableStr of collectionVariables) {
    const [collectionId, variableId] = collectionVariableStr.split('/');

    const collection = req.collections.find((c) => c.id === collectionId);
    if (!collection) {
      throw new RequestValidationError(`Invalid layer: ${collectionVariableStr}`);
    }

    if (!variablesByCollection[collectionId]) {
      variablesByCollection[collectionId] = [];
    }
    if (variableId) {
      const variable = collection.variables.find((v) => v.meta['concept-id'] === variableId);
      if (!variable) {
        throw new RequestValidationError(`Invalid layer: ${collectionVariableStr}`);
      }
      variablesByCollection[collectionId].push(variable);
    }
  }
  for (const collectionId of Object.keys(variablesByCollection)) {
    operation.addSource(collectionId, variablesByCollection[collectionId]);
  }

  operation.crs = query.crs;
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
    operation.granuleIds = query.granuleid.split(',');
  }

  // WMS requests only support synchronous execution
  operation.requireSynchronous = true;
  req.operation = operation;
  next();
}

/**
 * Express.js handler that handles calls to the WMS endpoint
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @param {function} next The next function in the chain
 * @returns {void}
 */
export default async function wmsFrontend(req, res, next) {
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
      return await getMap(req, res, next);
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
