const cmr = require('../util/cmr');

// CMR Granule ID may optionally be provided in the path
const GRANULE_URL_PATH_REGEX = /\/(?:G\d+-\w+)/g;

/**
 * Converts a Date object into an ISO String representation (truncates milliseconds)
 *
 * @param {Date} date The date to convert
 * @returns {string} An ISO string representation of the date, with milliseconds truncated
 */
function toISODateTime(date) {
  return date.toISOString().replace(/\.\d{3}/g, '');
}

/**
 * Express.js middleware which extracts parameters from the Harmony operation
 * and performs a granule query on them, determining which files are applicable
 * to the given operation.
 *
 * @param {http.IncomingMessage} req The client request, containing an operation
 * @param {http.ServerResponse} res The client response
 * @param {function} next The next function in the middleware chain
 * @returns {void}
 */
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

  const granuleMatch = req.url.match(GRANULE_URL_PATH_REGEX);
  if (granuleMatch) {
    // Assumes there can only be one granule
    const granuleId = granuleMatch[0].substr(1, granuleMatch[0].length - 1);
    cmrQuery.concept_id = granuleId;
  }

  try {
    const { sources } = operation;
    const queries = sources.map(async (source) => {
      const atomGranules = await cmr.queryGranulesForCollection(source.collection, cmrQuery);
      const granules = [];
      for (const granule of atomGranules) {
        const link = granule.links.find((g) => g.rel.endsWith('/data#') && !g.inherited);
        if (link) {
          if (process.env.staging_path && link.href.startsWith('http')) {
            // Testing with staged data in S3 or a local path
            const linkParts = link.href.split('/');
            link.href = `${process.env.staging_path}/${linkParts[linkParts.length - 1]}`;
          }
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
