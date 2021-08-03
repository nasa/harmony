import request from 'superagent';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';
import WorkItem, { WorkItemStatus } from '../../../../app/models/work-item';
import logger from '../util/log';
import { runPythonServiceFromPull, runQueryCmrFromPull, ServiceResponse } from '../service/service-runner';

const JSON_TYPE = 'application/json';

/**
 * Requests work items from Harmony
 */
async function pullWork(): Promise<{ item?: WorkItem; error?: string }> {
  try {
    const response = await request
      .get(env.pullUrl)
      .query(`serviceID=${env.harmonyService}`)
      .accept(JSON_TYPE)
      .timeout({
        response: 30_000, // Wait up to 30 seconds for the server to start sending
        deadline: 60_000, // but allow up to 60 seconds for the server to complete the response;
      });

    logger.info(response.text);
    return { item: response.body };
  } catch (err) {
    logger.error(`Request failed with error: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Pull work and execute it
 */
async function pullAndDoWork(): Promise<void> {
  const work = await pullWork();
  if (!work.error) {
    if (work.item) {
      logger.info('WORK ITEM:');
      logger.info(JSON.stringify(work.item));
      const workItem = work.item;
      if (workItem.scrollID) {
        runQueryCmrFromPull(work.item).then(async (queryResponse: ServiceResponse) => {
          logger.info('Finished work');
          if (queryResponse.batchCatalogs) {
            workItem.status = WorkItemStatus.SUCCESSFUL;
            workItem.results = queryResponse.batchCatalogs;
          } else {
            workItem.status = WorkItemStatus.FAILED;
          }
          // call back to Harmony to mark the work unit as complete or failed
          const response = await request
            .put(`${env.responseUrl}/${workItem.id}`)
            .type(JSON_TYPE)
            .accept(JSON_TYPE)
            .send(JSON.stringify(workItem));

          // TODO add retry or other error handling here
          if (response.error) {
            logger.error(`Error: received status [${response.status}] when updating WorkItem ${workItem.id}`);
            logger.error(`Error: ${response.error.message}`);
          }

          // wait a short time before polling again (100 ms)
          setTimeout(pullAndDoWork, 100);
        });
      }
    }
  } else if (work.error === 'Timemout') {
    // timeouts are expected - just try again after a short delay (100 ms)
    setTimeout(pullAndDoWork, 100);
  } else {
    // something bad happened
    logger.error(`Unexpected error while pulling work: ${work.error}`);
  }
}

export default class PullWorker implements Worker {
  async start(): Promise<void> {
    // poll the Harmony work endpoint
    pullAndDoWork();
  }
}
