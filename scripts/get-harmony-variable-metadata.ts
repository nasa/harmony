/* eslint-disable require-jsdoc */
import { loadServiceConfigs } from '../services/harmony/app/models/services';
import { cmrApiConfig, CmrUmmCollection, CmrUmmService, getServicesByIds, getUmmCollectionsByIds, getVariablesByIds } from '../services/harmony/app/util/cmr';
import * as fs from 'fs';
import logger from '../services/harmony/app/util/log';

const environmentMapping = {
  'prod': 'https://cmr.earthdata.nasa.gov',
  'uat': 'https://cmr.uat.earthdata.nasa.gov',
};

// Function to chunk an array into smaller arrays of a specific size
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

async function processCollectionsInChunksConcurrently(collections: Set<string>, chunkSize: number) {
  const collectionArray = Array.from(collections);
  const chunks = chunkArray(collectionArray, chunkSize);

  const promises = chunks.map(chunk => getUmmCollectionsByIds(chunk, process.env.BEARER_TOKEN));
  const results = await Promise.all(promises);
  return results.flat();
}

async function processVariablesConcurrently(collectionMetadata: Array<CmrUmmCollection>) {
  const promises = collectionMetadata.map(async (collection) => {
    if (collection.meta.associations?.variables) {
      const variableChunks = chunkArray(collection.meta.associations.variables, 100);

      // Fetch variables in chunks
      const chunkPromises = variableChunks.map(chunk =>
        getVariablesByIds(chunk, process.env.BEARER_TOKEN),
      );

      // Wait for all chunked promises to resolve
      const chunkResults = await Promise.all(chunkPromises);

      // Flatten the chunk results and combine them into a single array for the collection
      const variables = chunkResults.flat();

      return { collection, variables };
    } else {
      return { collection, variables: [] };
    }
  });

  // Process all collections concurrently
  const results = await Promise.all(promises);

  // Build the final result object
  const variablesByCollection: Record<string, any> = {};
  results.forEach(({ collection, variables }) => {
    variablesByCollection[collection.meta['concept-id']] = variables;
  });

  return variablesByCollection;
}

/**
 * Creates a map of concept ID to UMM-S record
 * @param ummRecords - an array of UMM-S records
 */
function createUmmRecordsMap(ummRecords: CmrUmmService[]): { [key: string]: CmrUmmService } {
  return ummRecords.reduce((allRecords, ummRecord) => {
    const conceptId = ummRecord.meta['concept-id'];
    allRecords[conceptId] = ummRecord;
    return allRecords;
  }, {});
}


async function saveVariablesByCollection(variablesByCollection: Record<string, any>, collectionMetadata: Array<CmrUmmCollection>) {
  const output = [];

  for (const collection of collectionMetadata) {
    const collectionId = collection.meta['concept-id'];
    const variables = variablesByCollection[collectionId] || [];

    for (const variable of variables) {
      const variableId = variable.meta['concept-id'];

      // Build the text string with required fields
      const text = `Abstract: ${collection.umm.Abstract || ''} ` +
                   `ISOTopicCategories: ${collection.umm.ISOTopicCategories?.join(', ') || ''} ` +
                   `Name: ${variable.umm.Name || ''} ` +
                   `Definition: ${variable.umm.Definition || ''} ` +
                   `Units: ${variable.umm.Units || ''}`;

      // Add this entry to the output
      output.push({
        collectionId,
        variableId,
        text,
      });
    }
  }

  // Write the result to a JSON file
  const outputPath = './variable_metadata.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  logger.info(`Saved output for ${output.length} variable metdata entries to ${outputPath}`);
}

/**
 * Runs the service comparison reporting any validation messages. If there are any errors print them out
 * and exit with a non-zero exit code.
 *
 * @param env - the CMR environment to check against
 */
async function getMetadata(env: string): Promise<void> {
  logger.info(`*** Running get metadata for ${env}`);
  const environment = environmentMapping[env];
  const collections = new Set<string>();
  cmrApiConfig.useToken = false;
  cmrApiConfig.baseURL = environment;
  const harmonyServiceConfigs = loadServiceConfigs(environment)
    .filter((config) => config.umm_s); // Ignore any service definitions that do not point to a UMM-S record
  const ummConceptIds = harmonyServiceConfigs.map((config) => config.umm_s);
  const services = new Set<string>(ummConceptIds);
  const ummRecords = await getServicesByIds(ummConceptIds, null);
  const ummRecordsMap = createUmmRecordsMap(ummRecords);
  for (const harmonyConfig of harmonyServiceConfigs) {
    const ummRecord = ummRecordsMap[harmonyConfig.umm_s];
    if (ummRecord.meta.associations) {
      for (const collection of ummRecord.meta.associations.collections) {
        collections.add(collection);
      }
    }
    // } else {
    //   console.log(ummRecord);
    // }
  }

  const providers = new Set<string>();
  collections.forEach(collection => {
    const provider = collection.split('-')[1];
    providers.add(provider);
  });

  logger.info(`There are ${services.size} services in ${env} associated with ${collections.size} collections`)

  // Get the full collection metadata for all of the collections - including the variable IDs
  logger.info('Querying for collection metadata and variable associations')
  const collectionMetadata = await processCollectionsInChunksConcurrently(collections, 20);

  // Now for each collection get the variable metadata
  logger.info('Querying for variable metadata')
  const variableMapping = await processVariablesConcurrently(collectionMetadata);

  await saveVariablesByCollection(variableMapping, collectionMetadata);
}

/**
 * Main function called from npm run metadata-uat or npm run metadata-prod
 */
async function main(environment: string): Promise<void> {
  await getMetadata(environment);
}

if (require.main === module) {
  const args = process.argv.slice(2); // Skip the first two which aren't arguments
  let environment = 'uat';

  if (args.length > 0) {
    environment = args[0];
  }

  void main(environment);
}