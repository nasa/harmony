import request from 'superagent';
import axios from 'axios';
import Agent from 'agentkeepalive';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';
import WorkItem, { WorkItemStatus } from '../../../../app/models/work-item';
import logger from '../util/log';
import { runPythonServiceFromPull, runQueryCmrFromPull, ServiceResponse } from '../service/service-runner';
import sleep from '../../../../app/util/sleep';

const JSON_TYPE = 'application/json';
const timeout = 30_000; // Wait up to 30 seconds for the server to start sending
/**
 * Requests work items from Harmony
 */
async function pullWork(): Promise<{ item?: WorkItem; status?: number; error?: string }> {
  try {
    const keepaliveAgent = new Agent({
      maxSockets: 10,
      maxFreeSockets: 10,
      timeout: 60000, // active socket keepalive for 60 seconds
      freeSocketTimeout: 30000, // free socket keepalive for 30 seconds
    });

    const response = await axios
      .get(env.pullUrl, {
        params: { serviceID: env.harmonyService },
        timeout,
        responseType: 'json',
        httpAgent: keepaliveAgent,
      });
      // .query(`serviceID=${env.harmonyService}`)
      // .accept(JSON_TYPE)
      // .timeout({
      //   response: timeout,
      //   deadline: 60_000, // but allow up to 60 seconds for the server to complete the response;
      // });
    if (response.status >= 400) {
      const errMsg = response.statusText ? response.statusText : 'Unknown error';
      return { error: errMsg, status: response.status };
    }
    return { item: response.data };
  } catch (err) {
    if (err.status !== 404 && err.message !== `Response timeout of ${timeout}ms exceeded`) {
      logger.error(`Request failed with error: ${err.message}`);
      return { error: err.message };
    }
    // 404s are expected when no work is available
    return {};
  }
}

/**
 * Pull work and execute it
 */
async function pullAndDoWork(): Promise<void> {
  // logger.debug('Getting work..');
  const work = await pullWork();
  if (!work.error) {
    if (work.item) {
      const workItem = work.item;
      // work items with a scrollID are only for the query-cmr service
      const workFunc = workItem.scrollID ? runQueryCmrFromPull : runPythonServiceFromPull;

      workFunc(work.item).then(async (serviceResponse: ServiceResponse) => {
        logger.info('Finished work');
        if (serviceResponse.batchCatalogs) {
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = serviceResponse.batchCatalogs;
        } else {
          logger.error(`Service failed with error: ${serviceResponse.error}`);
          workItem.status = WorkItemStatus.FAILED;
          workItem.errorMessage = `${serviceResponse.error}`;
        }
        // call back to Harmony to mark the work unit as complete or failed
        logger.info(`Sending response to Harmony for results ${JSON.stringify(work)}`);
        try {
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
        } catch (e) {
          logger.error(e);
        }
      });
    }
  } else if (work.error === `Response timeout of ${timeout}ms exceeded`) {
    // timeouts are expected - just try again after a short delay (100 ms)
    logger.debug('Polling timeout - retrying');
  } else if (work.status !== 404) {
    // something bad happened
    logger.error(`Full details: ${JSON.stringify(work)}`);
    logger.error(`Unexpected error while pulling work: ${work.error}`);
    sleep(10000);
  }
  setTimeout(pullAndDoWork, 1000);
}

export default class PullWorker implements Worker {
  async start(): Promise<void> {
    // poll the Harmony work endpoint
    pullAndDoWork();
  }
}
