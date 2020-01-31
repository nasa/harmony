const cmr = require('../util/cmr');
const { RequestValidationError } = require('../util/errors');

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

  cmrQuery.concept_id = operation.granuleIds;

  try {
    const { sources } = operation;
    const queries = sources.map(async (source) => {
      req.logger.info(`Querying granules ${source.collection}, ${JSON.stringify(cmrQuery)}`);
      const atomGranules = await cmr.queryGranulesForCollection(
        source.collection,
        cmrQuery,
        req.accessToken,
      );
      const granules = [];
      for (const granule of atomGranules) {
        const link = granule.links.find((g) => g.rel.endsWith('/data#') && !g.inherited);
        if (link) {
          if (process.env.STAGING_PATH && link.href.startsWith('http')) {
            // Testing with staged data in S3 or a local path
            const linkParts = link.href.split('/');
            link.href = `${process.env.STAGING_PATH}/${linkParts[linkParts.length - 1]}`;
          }
          granules.push({ id: granule.id, name: granule.title, url: link.href });
        }
      }
      if (granules.length === 0) {
        throw new RequestValidationError('No matching granules found.');
      }
      return Object.assign(source, { granules });
    });

    await Promise.all(queries);
  } catch (e) {
    if (e instanceof RequestValidationError) {
      return next(e);
    }
    req.logger.error(e);
  }
  return next();
}

module.exports = cmrGranuleLocator;
