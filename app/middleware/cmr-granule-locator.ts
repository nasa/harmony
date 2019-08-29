const winston = require('winston');
const cmr = require('../util/cmr');

function toISODateTime(date) {
    return date.toISOString().replace(/\.\d{3}/g, '');
}

async function cmrGranuleLocator(req, res, next, logger = winston) {
    const operation = req.operation;

    if (!operation) return next();

    const cmrQuery = {};

    if (operation.temporal) {
        const { start, end } = operation.temporal;
        cmrQuery.temporal = `${toISODateTime(start)},${toISODateTime(end)}`;
    }
    if (operation.boundingRectangle) {
        cmrQuery.bounding_box =  operation.boundingRectangle.join(',');
    }

    try {
        const sources = operation.sources;
        const queries = sources.map(async function queryGranules(source) {
            const atomGranules = await cmr.queryGranulesForCollection(source.collection, cmrQuery);
            const granules = [];
            for (const granule of atomGranules) {
                const link = granule.links.find((g) => g.rel.endsWith('/data#') && !g.inherited);
                if (link) {
                    granules.push({ id: granule.id, url: link.href });
                }
            }
            return Object.assign(source, { granules: granules });
        });

        await Promise.all(queries);
    }
    catch (e) {
        console.log(e);
    }
    console.log(JSON.stringify(req.operation.model, null, 2));
    next();
};

module.exports = cmrGranuleLocator;