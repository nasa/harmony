const cmr = require('../util/cmr');

function toISODateTime(date) {
  return date.toISOString().replace(/\.\d{3}/g, '');
}

async function cmrGranuleLocator(req, res, next) {
  const { operation } = req;

  if (!operation) return next();

  const cmrQuery = {};

  if (operation.temporal) {
    const { start, end } = operation.temporal;
    cmrQuery.temporal = `${toISODateTime(start)},${toISODateTime(end)}`;
  }
  if (operation.boundingRectangle) {
    cmrQuery.bounding_box = operation.boundingRectangle.join(',');
  }

  try {
    const { sources } = operation;
    const queries = sources.map(async (source) => {
      const atomGranules = await cmr.queryGranulesForCollection(source.collection, cmrQuery);
      const granules = [];
      for (const granule of atomGranules) {
        const link = granule.links.find((g) => g.rel.endsWith('/data#') && !g.inherited);
        if (link) {
          // Uncomment for local testing
          const linkParts = link.href.split('/');
          link.href = `tmp/${linkParts[linkParts.length - 1]}`;
          // End uncomment for local testing
          granules.push({ id: granule.id, name: granule.title, url: link.href });
        }
      }
      return Object.assign(source, { granules });
    });

    await Promise.all(queries);
  } catch (e) {
    req.logger.error(e);
  }
  req.logger.debug(JSON.stringify(req.operation.model, null, 2));
  return next();
}

module.exports = cmrGranuleLocator;
