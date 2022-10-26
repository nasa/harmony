// functions used for creating batches of inputs to aggregation steps

import { Logger } from 'winston';
import { Transaction } from '../util/db';
import BatchItem, { getByJobServiceBatch, getCurrentBatchSizeAndCount, getMaxSortIndexForJobServiceBatch } from '../models/batch-item';
import { Batch, withHighestBatchIDForJobService } from '../models/batch';
import { createDecrypter, createEncrypter } from './crypto';
import env from './env';
import DataOperation from '../models/data-operation';
import { objectStoreForProtocol } from './object-store';
import axios from 'axios';
import { getCatalogItemUrls, readCatalogItems } from './stac';
import WorkItemUpdate from '../models/work-item-update';
import WorkflowStep from '../models/workflow-steps';


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
 * Get the sizes of all the data items/granules returned for the WorkItem as well as urls to
 * the associated STAC item files.
 *
 * @param update - TODO
 * @param operation - TODO
 * @param logger - TODO
 * @returns
 */
export async function resultItemSizes(update: WorkItemUpdate, operation: object, logger: Logger):
Promise<{ outputItemSizes: number[], outputStacItemUrls: string[] }> {
  let outputItemSizes = [];
  let outputStacItemUrls = [];
  if (update.outputItemSizes?.every(s => s > 0)) {
    // if all the granules sizes were provided by the service then just use them, otherwise
    // get the ones that were not provided
    // eslint-disable-next-line prefer-destructuring
    outputItemSizes = update.outputItemSizes;
    // TODO figure out how to only do this if we need batching
    for (const catalogUrl of update.results) {
      const stacItemUrls = await getCatalogItemUrls(catalogUrl);
      outputStacItemUrls = outputStacItemUrls.concat(stacItemUrls);
    }
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
  return { outputItemSizes, outputStacItemUrls };
}

/**
 * Generate batches for results returned by a service to be used by a subsequent aggregating step.
 *
 * @param tx - The database transaction
 * @param workflowStep - The step in the workflow that needs batching
 * @param stacItemUrls - An array of paths to STAC items
 */
export async function handleBatching(
  tx: Transaction,
  workflowStep: WorkflowStep,
  stacItemUrls: string[],
  itemSizes: number[],
  workItemSortIndex: number)
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
      console.log(e);
    }
  }

  // assign the new batch items to batches
  const batchItems = await getByJobServiceBatch(tx, jobID, serviceID, null, true);
  index = 0;
  // let currentBatch: Batch;
  let nextSortIndex: number;
  while (index < batchItems.length) {
    const currentBatch = await withHighestBatchIDForJobService(tx, jobID, serviceID);
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
            console.log(e);
          }
          index += 1;
        } else {
          // create a work item for the current batch
          // TODO create aggregation work item
          // const newWorkItem = WorkItem.new({
          //   jobID,
          //   serviceID,
          //   status: WorkItemStatus.READY,
          //   workflowStepIndex: workflowStep.stepIndex,

          // });

          // create a new batch
          const newBatch = new Batch({
            jobID,
            serviceID,
            batchID: currentBatch.batchID + 1,
          });
          try {
            await newBatch.save(tx);
            await newBatch.save(tx);
            batchItem.batchID = newBatch.batchID;
            await batchItem.save(tx);
          } catch (e) {
            console.log(e);
          }
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
        console.log(e);
      }
      nextSortIndex = 0;
    }
  }

}