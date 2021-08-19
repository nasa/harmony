import axios from 'axios';
import Agent from 'agentkeepalive';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';
import WorkItem, { WorkItemStatus } from '../../../../app/models/work-item';
import logger from '../util/log';
import { runPythonServiceFromPull, runQueryCmrFromPull, ServiceResponse } from '../service/service-runner';
import sleep from '../../../../app/util/sleep';

const timeout = 3_000; // Wait up to 30 seconds for the server to start sending
const activeSocketKeepAlive = 6_000;
const maxSockets = 1;
const maxFreeSockets = 1;

const keepaliveAgent = new Agent({
  maxSockets,
  maxFreeSockets,
  timeout: activeSocketKeepAlive, // active socket keepalive for 60 seconds
  freeSocketTimeout: timeout, // free socket keepalive for 30 seconds
});

/**
 * Requests work items from Harmony
 */
async function pullWork(): Promise<{ item?: WorkItem; status?: number; error?: string }> {
  try {
    const response = await axios
      .get(env.pullUrl, {
        params: { serviceID: env.harmonyService },
        timeout,
        responseType: 'json',
        httpAgent: keepaliveAgent,
        validateStatus(status) {
          return status === 404 || (status >= 200 && status < 400);
        },
      });

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
  const work = await pullWork();
  if (!work.error) {
    if (work.item) {
      const workItem = work.item;
      // work items with a scrollID are only for the query-cmr service
      const workFunc = workItem.scrollID ? runQueryCmrFromPull : runPythonServiceFromPull;

      await workFunc(work.item).then(async (serviceResponse: ServiceResponse) => {
        logger.debug('Finished work');
        if (serviceResponse.batchCatalogs) {
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = serviceResponse.batchCatalogs;
        } else {
          logger.error(`Service failed with error: ${serviceResponse.error}`);
          workItem.status = WorkItemStatus.FAILED;
          workItem.errorMessage = `${serviceResponse.error}`;
        }
        // call back to Harmony to mark the work unit as complete or failed
        logger.debug(`Sending response to Harmony for results ${JSON.stringify(work)}`);
        try {
          const response = await axios.put(`${env.responseUrl}/${workItem.id}`, workItem, { httpAgent: keepaliveAgent });

          if (response.status >= 400) {
            logger.error(`Error: received status [${response.status}] when updating WorkItem ${workItem.id}`);
            logger.error(`Error: ${response.statusText}`);
          }
        } catch (e) {
          logger.error(e);
        }
      });
    }
  } else if (work.error === `timeout of ${timeout}ms exceeded`) {
    // timeouts are expected - just try again after a short delay (100 ms)
    logger.debug('Polling timeout - retrying');
  } else if (work.status !== 404) {
    // something bad happened
    logger.error(`Full details: ${JSON.stringify(work)}`);
    logger.error(`Unexpected error while pulling work: ${work.error}`);
    sleep(3000);
  }
  setTimeout(pullAndDoWork, 500);
}

export default class PullWorker implements Worker {
  async start(): Promise<void> {
    // poll the Harmony work endpoint
    pullAndDoWork();
  }
}
