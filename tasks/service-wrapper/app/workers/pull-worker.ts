import axios from 'axios';
import Agent from 'agentkeepalive';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';
import WorkItem, { WorkItemStatus, WorkItemRecord } from '../../../../app/models/work-item';
import logger from '../util/log';
import { runPythonServiceFromPull, runQueryCmrFromPull, ServiceResponse } from '../service/service-runner';
import sleep from '../../../../app/util/sleep';

const timeout = 3_000; // Wait up to 3 seconds for the server to start sending
const activeSocketKeepAlive = 6_000;
const maxSockets = 1;
const maxFreeSockets = 1;
const maxRetries = 3;

const keepaliveAgent = new Agent({
  keepAlive: true,
  maxSockets,
  maxFreeSockets,
  timeout: activeSocketKeepAlive, // active socket keepalive for 60 seconds
  freeSocketTimeout: timeout, // free socket keepalive for 30 seconds
});

const workUrl = `http://${env.backendHost}:${env.backendPort}/service/work`;
logger.debug(`WORK URL: ${workUrl}`);

/**
 * Requests work items from Harmony
 */
async function _pullWork(): Promise<{ item?: WorkItem; status?: number; error?: string }> {
  try {
    const response = await axios
      .get(workUrl, {
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
    return { item: response.data, status: response.status };
  } catch (err) {
    if (err.status !== 404 && err.message !== `Response timeout of ${timeout}ms exceeded`) {
      logger.error(`Request failed with error: ${err.message}`);
      return { error: err.message };
    }
    // 404s are expected when no work is available
    return { status: err.status };
  }
}

/**
 * Pull work and execute it
 */
async function _pullAndDoWork(): Promise<void> {
  const work = await _pullWork();
  if (!work.error) {
    if (work.item) {
      const workItem = work.item;
      // work items with a scrollID are only for the query-cmr service
      const workFunc = workItem.scrollID ? runQueryCmrFromPull : runPythonServiceFromPull;
      logger.debug('Calling work function');
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
        logger.debug(`Sending response to Harmony for results work item id ${work.item.id} and job id ${work.item.jobID}`);
        let tries = 0;
        let complete = false;
        while (tries < maxRetries && !complete) {
          tries += 1;
          try {
            const response = await axios.put(`${workUrl}/${workItem.id}`, workItem, { httpAgent: keepaliveAgent });
            if (response.status >= 400) {
              logger.error(`Error: received status [${response.status}] when updating WorkItem ${workItem.id}`);
              logger.error(`Error: ${response.statusText}`);
            } else {
              complete = true;
            }
          } catch (e) {
            logger.error(e);
          }
          if (tries < maxRetries && !complete) {
            logger.info(`Retrying failure to update work item id ${work.item.id} and job id ${work.item.jobID}`);
            await sleep(1000);
          }
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
    await sleep(3000);
  }
  setTimeout(_pullAndDoWork, 500);
}

/**
 * Call the sidecar query-cmr service once to get around a k8s client bug
 */
function _primeCmrService(): void {
  const exampleWorkItemProps = {
    jobID: '1',
    serviceID: 'harmony-services/query-cmr:latest',
    status: WorkItemStatus.READY,
    workflowStepIndex: 0,
    operation: { requestId: 'abc' },
    scrollID: '1234',
  } as WorkItemRecord;

  runQueryCmrFromPull(new WorkItem(exampleWorkItemProps));
}

/**
 * Call the sidecar service once to get around a k8s client bug
 */
function _primeService(): void {
  const exampleWorkItemProps = {
    jobID: '1',
    serviceID: 'harmony-services/query-cmr:latest',
    status: WorkItemStatus.READY,
    workflowStepIndex: 0,
    operation: { requestId: 'abc' },
  } as WorkItemRecord;
  runPythonServiceFromPull(new WorkItem(exampleWorkItemProps));
}

export default class PullWorker implements Worker {
  async start(): Promise<void> {
    // workaround for k8s client bug https://github.com/kubernetes-client/javascript/issues/714
    if (env.harmonyService === 'harmonyservices/query-cmr:latest') {
      _primeCmrService();
    } else {
      _primeService();
    }

    // poll the Harmony work endpoint
    _pullAndDoWork().catch((e) => {
      logger.error(e.message);
    });
  }
}

export const exportedForTesting = {
  _pullWork,
};
