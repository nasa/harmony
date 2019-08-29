const cmrutil = require('../util/cmr');

// CMR Collection IDs separated by delimiters of single "+" or single whitespace (some clients may translate + to space)
const COLLECTION_URL_PATH_REGEX = /^\/(?:C\d+-\w+[+\s])*(?:C\d+-\w+)+\//g;

async function loadVariablesForCollection(collection) {
    collection.variables = await cmrutil.getVariablesForCollection(collection);
}

module.exports = async function cmrCollectionReader(req, res, next) {
    try {
        const collectionMatch = req.url.match(COLLECTION_URL_PATH_REGEX);
        if (collectionMatch) {
            const collectionIdStr = collectionMatch[0].substr(1, collectionMatch[0].length - 2);
            const collectionIds = collectionIdStr.split(/[+\s]/g);
            req.collectionIds = collectionIds;
            req.url = req.url.replace(collectionMatch[0], '/');
            req.logger.info({ collectionIds: collectionIds })

            const collections = req.collections = await cmrutil.getCollectionsByIds(collectionIds);

            const promises = [];
            for (const collection of collections) {
                promises.push(loadVariablesForCollection(collection));
            }
            await Promise.all(promises);
        }
        else {
            req.collectionIds = [];
            req.collections = [];
        }
        next();
    } catch (error) {
        req.collectionIds = [];
        req.collections = [];
        next(error);
    }
};
