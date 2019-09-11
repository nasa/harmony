const axios = require('axios');
const querystring = require('querystring');

const cmrApi = axios.create({
  baseURL: 'https://cmr.uat.earthdata.nasa.gov/',
});

async function cmrSearch(path, query) {
  const querystr = querystring.stringify(query);
  const response = await cmrApi.get([path, querystr].join('?'));
  // TODO: Error responses
  return response.data;
}

async function queryVariables(query) {
  const variablesResponse = await cmrSearch('/search/variables.json', query);
  return variablesResponse.items;
}

async function queryCollections(query) {
  const collectionsResponse = await cmrSearch('/search/collections.json', query);
  return collectionsResponse.feed.entry;
}

async function queryGranules(query) {
  // TODO: Paging / hits
  const granulesResponse = await cmrSearch('/search/granules.json', query);
  return granulesResponse.feed.entry;
}

function getCollectionsByIds(ids) {
  return queryCollections({ concept_id: ids, page_size: 2000 });
}

function getVariablesByIds(ids) {
  return queryVariables({ concept_id: ids, page_size: 2000 });
}

async function getVariablesForCollection(collection) {
  const varIds = collection.associations && collection.associations.variables;
  if (varIds) {
    return getVariablesByIds(varIds);
  }

  return [];
}

function queryGranulesForCollection(collectionId, query, limit = 10) {
  const baseQuery = {
    collection_concept_id: collectionId,
    page_size: limit,
  };
  return queryGranules(Object.assign(baseQuery, query));
}

module.exports = {
  getCollectionsByIds,
  getVariablesByIds,
  getVariablesForCollection,
  queryGranulesForCollection,
};
