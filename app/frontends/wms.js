const mustache = require('mustache');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const DataOperation = require('../models/data-operation');
const urlUtil = require('../util/url');

const readFile = promisify(fs.readFile);

class RequestValidationError extends Error {}

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

function validateParamIn(lowercasedParamMap, paramName, values, allowNull = false) {
  const value = lowercasedParamMap[paramName];
  if (allowNull && !Object.prototype.hasOwnProperty.call(lowercasedParamMap, paramName)) {
    return true;
  }
  if (values.length === 0) {
    throw new RequestValidationError(`Query parameter "${paramName}" has no valid values`);
  }
  if (values.indexOf(value) === -1) {
    const quoted = values.map((v) => `"${v}"`).join(',');
    const containsText = values.length === 1 ? ' one of' : '';
    throw new RequestValidationError(`Query parameter "${paramName}" must be${containsText} ${quoted}`);
  }
  return true;
}

// TODO This could / should be cached
async function getWmsResponseTemplate(requestParam) {
  const templatePath = path.join(__dirname, `templates/wms-1.3.0/${requestParam}.mustache.xml`);
  return readFile(templatePath, { encoding: 'utf8' });
}

async function renderToTemplate(requestParam, context) {
  const template = await getWmsResponseTemplate(requestParam);
  return mustache.render(template, context);
}

function requestError(res, message) {
  return res.status(400).json(message);
}

async function getCapabilities(req, res /* , next */) {
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
      bbox,
      label: collectionLongLabel,
      variables: [],
    };

    // TODO: What if a collection has no variables?
    for (const variable of collection.variables) {
      collectionData.variables.push({
        name: `${collection.id}/${variable.concept_id}`,
        description: `${variable.long_name}\n${collectionLongLabel}\n\n${collection.summary}`,
        label: `${variable.name} (${variable.long_name})`,
        bbox,
      });
    }
    collections.push(collectionData);
  }

  const capabilities = {
    url: urlUtil.getRequestUrl(req),
    collections,
  };

  res.status(200);
  res.set('Content-Type', 'text/xml');
  return res.send(await renderToTemplate('GetCapabilities', capabilities));
}

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

    const variable = collection.variables.find((v) => v.concept_id === variableId);
    if (!variable) {
      throw new RequestValidationError(`Invalid layer: ${collectionVariableStr}`);
    }
    if (!variablesByCollection[collectionId]) {
      variablesByCollection[collectionId] = [];
    }
    variablesByCollection[collectionId].push({ id: variable.concept_id, name: variable.name });
  }
  for (const collectionId of Object.keys(variablesByCollection)) {
    operation.addSource(collectionId, variablesByCollection[collectionId]);
  }

  operation.crs = query.crs;
  operation.isTransparent = query.transparent === 'TRUE';
  operation.outputFormat = query.format;
  operation.outputWidth = query.width;
  operation.outputHeight = query.height;
  if (dpi) {
    operation.outputDpi = parseInt(dpi, 10);
  }
  operation.styles = query.styles.split(',');

  const [west, south, east, north] = query.bbox.split(',').map((c) => parseFloat(c));
  operation.boundingRectangle = [west, south, east, north];

  // FIXME: Temporal (time param)
  // operation.setTime(start, end);

  // TODO: Optional WMS "elevation" param (someday)

  // If a request is for a graphic element format that does not have explicit width and height,
  // the client shall include the WIDTH and HEIGHT values in the request and a server may use
  // them as helpful information in constructing the output map.

  req.operation = operation;
  next();
}

async function wmsFrontend(req, res, next) {
  const query = {};
  for (const k of Object.keys(req.query)) {
    query[k.toLowerCase()] = req.query[k];
  }
  req.wmsQuery = query;

  try {
    validateParamIn(query, 'service', ['WMS']);
    validateParamIn(query, 'request', ['GetCapabilities', 'GetMap']);

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
    // FIXME: Handle 'exceptions' param
    if (e instanceof RequestValidationError) {
      return requestError(res, e.message);
    }

    throw e;
  }
}

module.exports = wmsFrontend;
