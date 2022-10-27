// functions used for creating batches of inputs to aggregation steps

import { Logger } from 'winston';
import { v4 as uuid } from 'uuid';
import { Transaction } from '../util/db';
import BatchItem, { getByJobServiceBatch, getCurrentBatchSizeAndCount, getItemUrlsForJobServiceBatch, getMaxSortIndexForJobServiceBatch } from '../models/batch-item';
import { Batch, withHighestBatchIDForJobService } from '../models/batch';
import { createDecrypter, createEncrypter } from './crypto';
import env from './env';
import DataOperation from '../models/data-operation';
import { objectStoreForProtocol } from './object-store';
import axios from 'axios';
import { getCatalogItemUrls, readCatalogItems } from './stac';
import WorkItemUpdate from '../models/work-item-update';
import WorkflowStep from '../models/workflow-steps';
import { WorkItemStatus } from 'app/models/work-item-interface';

/**
 * Get the size in bytes of the object at the given url
 *
 * @param url - the url of the object
 * @param token - the access token for the user's request
 * @param logger - a Logger instance
 * @returns the size of the object in bytes
 */
export async function sizeOfObject(url: string, token: string, logger: Logger): Promise<number> {
  logger.debug(`Reading size of data at ${url}`);
  const parsed = new URL(url);
  const protocol = parsed.protocol.toLowerCase().replace(/:$/, '');
  let result;
  try {
    let res;
    switch (protocol) {
      case 's3':
        const s3 = objectStoreForProtocol('s3');
        res = await s3.headObject(url);
        result = res.ContentLength;
        break;

      default:

        const headers = token ? { authorization: `Bearer ${token}` } : {};
        res = await axios.head(url, { headers: headers });
        result = parseInt(res.headers['content-length']);
        break;
    }
  } catch (e) {
    logger.error(e);
    result = 0;
  }

  logger.debug(`ContentLength: ${result}`);
  return result;
}

/**
 * Read and parse a STAC catalog and return the links to the data items
 *
 * @param s3Url - the s3 url of the catalog
 */
export async function readCatalogLinks(s3Url: string, logger: Logger): Promise<string[]> {
  logger.debug(`Reading STAC catalog ${s3Url}`);
  const items = await readCatalogItems(s3Url);

  return items.map((item) => item.assets.data.href);
}

/**
 * Get the urls of the STAC items contained in the STAC catalogs returned in a work item update
 * @param results - the url(s) of the STAC catalog(s) returned in the work item update
 * @returns
 */
export async function outputStacItemUrls(results: string[]):
Promise<string[]> {
  let urls: string[] = [];
  for (const catalogUrl of results) {
    const stacItemUrls = await getCatalogItemUrls(catalogUrl);
    urls = urls.concat(stacItemUrls);
  }
  return urls;
}

/**
 * Get the sizes of all the data items/granules returned for the WorkItem.
 *
 * @param update - information about the work item update
 * @param operation - the DataOperation for the user's request
 * @param logger - the Logger for the request
 * @returns
 */
export async function resultItemSizes(update: WorkItemUpdate, operation: object, logger: Logger):
Promise<number[]> {
  let outputItemSizes = [];
  if (update.outputItemSizes?.every(s => s > 0)) {
    // if all the granules sizes were provided by the service then just use them, otherwise
    // get the ones that were not provided
    // eslint-disable-next-line prefer-destructuring
    outputItemSizes = update.outputItemSizes;

  } else if (update.results) {
    const encrypter = createEncrypter(env.sharedSecretKey);
    const decrypter = createDecrypter(env.sharedSecretKey);
    const op = new DataOperation(operation, encrypter, decrypter);
    const token = op.unencryptedAccessToken;
    let index = 0;
    for (const catalogUrl of update.results) {
      const links = await exports.readCatalogLinks(catalogUrl, logger);
      // eslint-disable-next-line @typescript-eslint/no-loop-func
      const sizes = await Promise.all(links.map(async (link) => {
        const serviceProvidedSize = update.outputItemSizes?.[index];
        index += 1;
        // use the value provided by the service if available
        if (serviceProvidedSize && serviceProvidedSize > 0) {
          return serviceProvidedSize;
        }

        // try to get the size using a HEAD request
        return exports.sizeOfObject(link, token, logger);
      }));
      outputItemSizes = outputItemSizes.concat(sizes);
    }
  }
  return outputItemSizes;
}

/**
 *
 * @param jobID - the UUID associated with the job
 * @param stepIndex - the index of the step in the workflow
 * @param batchID - The ID of the batch to use when creating the catalog
 * @param sourceCollection - The CMR collection concept ID
 * @param stacItemUrls - links to the STAC item files for the catalog
 * @returns the URL to resulting STAC catalog
 */
async function createStacCatalogForBatch(
  jobID: string,
  stepIndex: number,
  batchID: number,
  sourceCollection: string,
  stacItemUrls):
  Promise<string> {
  const catalogUrl =
    `s3://${env.artifactBucket}/${jobID}/batches/${stepIndex}/${batchID}/catalog.json`;

  const sourceUrl = `${process.env.CMR_ENDPOINT}/search/concepts/${sourceCollection}`;

  const sourceLink = {
    'rel': 'harmony_source',
    'href': sourceUrl,
  };

  const itemLinks = stacItemUrls.map((url) => {
    return {
      'rel': 'item',
      'href': url,
      'type': 'application/json',
      'title': 'data item',
    };
  });

  const links = [sourceLink, ...itemLinks];

  const catalog = {
    'stac_version': '1.0.0-beta.2',
    'stac_extensions': [],
    'id': uuid(),
    'links': links,
    'description': `CMR collection ${sourceCollection} granules`,
  };

  const s3 = objectStoreForProtocol('s3');
  await s3.upload(JSON.stringify(catalog, null, 2), catalogUrl, null, 'application/json');

  return catalogUrl;
}

/**
 * Create a STAC catalog for a batch then create an aggregating work item to process it
 *
 * @param tx - the database transaction
 * @param workflowStep- the step in the workflow that needs batching
 * @param batch - the Batch to process
 */
async function createCatalogAndWorkItemForBatch(tx: Transaction, workflowStep: WorkflowStep, batch: Batch): Promise<void> {
  const { jobID, serviceID, stepIndex } = workflowStep;
  const batchItemUrls = await getItemUrlsForJobServiceBatch(tx, jobID, serviceID, batch.batchID);
  // create STAC catalog for the batch
  const catalogUrl = await createStacCatalogForBatch(
    jobID,
    stepIndex,
    batch.batchID,
    workflowStep.collectionsForOperation()[0],
    batchItemUrls);

  // create a work item for the batch

  // const newWorkItem = WorkItem.new({
  //   jobID,
  //   serviceID,
  //   status: WorkItemStatus.READY,
  //   workflowStepIndex: workflowStep.stepIndex,

  // });
}

/**
 * Generate batches for results returned by a service to be used by a subsequent aggregating step.
 *
 * @param tx - The database transaction
 * @param workflowStep - The step in the workflow that needs batching
 * @param stacItemUrls - An array of paths to STAC items
 * @param allWorkItemsForStepComplete - true if all the work items for the current step are complete
 * @param logger - The logger for the request
 */
export async function handleBatching(
  tx: Transaction,
  workflowStep: WorkflowStep,
  stacItemUrls: string[],
  itemSizes: number[],
  workItemSortIndex: number,
  allWorkItemsForStepComplete: boolean,
  logger: Logger)
  : Promise<void> {
  const { jobID, serviceID } = workflowStep;
  let { maxBatchInputs, maxBatchSizeInBytes } = workflowStep;
  maxBatchInputs = maxBatchInputs || env.maxBatchInputs;
  maxBatchSizeInBytes = maxBatchSizeInBytes || env.maxBatchSizeInBytes;

  // TODO figure out locking needed

  let index = 0;
  let startIndex = 0;
  if (!workItemSortIndex) {
    startIndex = await getMaxSortIndexForJobServiceBatch(
      tx,
      jobID,
      serviceID,
      null,
    );
    if (startIndex === null) {
      startIndex = 0;
    } else {
      startIndex += 1;
    }
  }

  // create new batch items for the STAC items in the results
  for (const url of stacItemUrls) {
    const sortIndex = workItemSortIndex || (startIndex + index);
    const batchItem = new BatchItem({
      jobID,
      serviceID,
      stacItemUrl: url,
      itemSize: itemSizes[index],
      sortIndex,
    });
    index += 1;
    try {
      await batchItem.save(tx);
    } catch (e) {
      logger.error(e);
    }
  }

  // assign the new batch items to batches
  const batchItems = await getByJobServiceBatch(tx, jobID, serviceID, null, true);
  index = 0;
  let nextSortIndex: number;
  let currentBatch = await withHighestBatchIDForJobService(tx, jobID, serviceID);
  while (index < batchItems.length) {
    if (currentBatch) {
      const batchItem = batchItems[index];
      const maxSortIndex = await getMaxSortIndexForJobServiceBatch(
        tx,
        jobID,
        serviceID,
        currentBatch.batchID);
      if (maxSortIndex === null) {
        nextSortIndex = 0;
      } else {
        nextSortIndex = maxSortIndex + 1;
      }

      if (batchItem.sortIndex === nextSortIndex) {
        const { sum, count } = await getCurrentBatchSizeAndCount(tx, jobID, serviceID, currentBatch.batchID);
        const currentBatchSize = sum;
        const currentBatchCount = count;
        if (currentBatchSize + batchItem.itemSize <= maxBatchSizeInBytes
          && currentBatchCount + 1 <= maxBatchInputs) {
          // add the batch item to the batch
          batchItem.batchID = currentBatch.batchID;
          try {
            await batchItem.save(tx);
          } catch (e) {
            logger.error(e);
          }
          index += 1;
        } else {
          // create STAC catalog and next work item for the current batch
          await createCatalogAndWorkItemForBatch(tx, workflowStep, currentBatch);

          // create a new batch
          const newBatch = new Batch({
            jobID,
            serviceID,
            batchID: currentBatch.batchID + 1,
          });
          try {
            await newBatch.save(tx);
            batchItem.batchID = newBatch.batchID;
            await batchItem.save(tx);
          } catch (e) {
            logger.error(e);
          }
          currentBatch = newBatch;
          index += 1;
        }
      } else {
        break;
      }
    } else {
      // no current batch so create a new one
      const newBatch = new Batch({
        jobID,
        serviceID,
        batchID: 0,
      });
      try {
        await newBatch.save(tx);
      } catch (e) {
        logger.error(e);
      }
      currentBatch = newBatch;
      nextSortIndex = 0;
    }
  }
  // if this is the last work item for the step, save the catalog
  // and create a new aggregating work item since this is the last batch
  if (allWorkItemsForStepComplete) {
    await createCatalogAndWorkItemForBatch(tx, workflowStep, currentBatch);
  }
}