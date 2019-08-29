const mustache = require('mustache');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);

// TODO This could / should be cached
async function getWcsResponseTemplate(requestParam) {
  const templatePath = path.join(__dirname, `templates/wcs-1.0.0/${requestParam}.mustache.xml`);
  return await readFile(templatePath, { encoding: 'utf8' });
}

async function renderToTemplate(requestParam, context) {
  const template = await getWcsResponseTemplate(requestParam)
  return mustache.render(template, context);
}

const getFullUrl = (req) =>
  url.format({
    protocol: req.protocol,
    host: req.get('host'),
    pathname: req.originalUrl.split('?')[0],
  });

async function getCapabilities(req, res, next) {
  const coverages = [];

  for(let collection of req.collections) {
    let bbox;
    if (collection.boxes && collection.boxes.length === 1) {
      const box = collection.boxes[0].split(' ');
      bbox = { south: box[0], west: box[1], north: box[2], east: box[3] }
    }
    else {
      // TODO: Coverages that are not single bounding boxes
      bbox = { south: -90, west: -180, north: 90, east: 180 };
    }
    const collectionShortLabel = `${collection.short_name} v${collection.version_id}`;
    const collectionLongLabel = `${collectionShortLabel} (${collection.archive_center || collection.data_center})`;
    // TODO: What if a collection has no variables?
    for (const variable of collection.variables) {
      coverages.push({
        name: `${collection.id}/${variable.concept_id}`,
        description: `${variable.long_name}\n${collectionLongLabel}\n\n${collection.summary}`,
        label: `${collectionShortLabel}: ${variable.name} (${variable.long_name})`,
        bbox: bbox
      });
    }
  }

  const capabilities = {
    url: getFullUrl(req),
    coverages: coverages
  }

  res.status(200);
  res.set('Content-Type', 'text/xml');
  return res.send(await renderToTemplate('GetCapabilities', capabilities));
}

// SERVICE=WCS&REQUEST=DescribeCoverage&VERSION=1.0.0&COVERAGE=C1215669046-GES_DISC/V1224729877-GES_DISC
async function describeCoverage(req, res, next) {
  const coverageId = req.normalizedQuery.coverage;
  if (!coverageId) {
    return requestError(res, 'Query parameter "COVERAGE" is required');
  }
  const [collectionId, variableId] = coverageId.split('/');
  const collection = req.collections.find((coll) => coll.id == collectionId);
  if (!collection) {
    return responseError(res, `Invalid coverage: ${coverageId}`)
  }
  const variable = collection.variables.find((variable) => variable.concept_id == variableId);
  if (!variable) {
    return responseError(res, `Invalid coverage: ${coverageId}`)
  }

  const coverage = {};

  res.status(200);
  res.set('Content-Type', 'text/xml');
  return res.send(await renderToTemplate('DescribeCoverage', coverage));
}

function requestError(res, message) {
  return res.status(400).json(message);
}

async function wcsFrontend(req, res, next) {
  const normalizedQuery = {};
  for (let k of Object.keys(req.query)) {
    normalizedQuery[k.toLowerCase()] = req.query[k];
  }
  req.normalizedQuery = normalizedQuery;

  // "query":{"SERVICE":"WCS","REQUEST":"GetCapabilities","VERSION":"1.0.0"}}
  if (normalizedQuery.service !== 'WCS') {
    return requestError(res, 'Query parameter "SERVICE=WCS" is required');
  }

  const version = normalizedQuery.version;
  if (version && version !== '1.0.0') {
    return requestError(res, `WCS version "${version}" is not supported.  This server only supports 1.0.0.`);
  }
  const acceptVersions = normalizedQuery.acceptversions;
  if (acceptVersions && acceptVersions.indexOf('1.0.0') === -1) {
    return requestError(res, `No supported WCS version found.  This server only supports 1.0.0.`);
  }

  const wcsRequest = normalizedQuery.request;

  if (!wcsRequest){
    return requestError(res, 'Query parameter "REQUEST" is required');
  }

  if (wcsRequest === 'GetCapabilities') {
    return await getCapabilities(req, res, next);
  }
  else if (wcsRequest === 'DescribeCoverage') {
    return await describeCoverage(req, res, next);
  }
  else {
    return requestError(res, `WCS REQUEST type "${wcsRequest}" is not supported`);
  }
};

module.exports = wcsFrontend;