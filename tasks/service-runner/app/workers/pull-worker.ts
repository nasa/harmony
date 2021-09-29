import axios from 'axios';
import Agent from 'agentkeepalive';
import { Worker } from '../../../../app/workers/worker';
import { sanitizeImage } from '../../../../app/util/string';
import env from '../util/env';
import WorkItem, { WorkItemStatus, WorkItemRecord } from '../../../../app/models/work-item';
import logger from '../../../../app/util/log';
import { runPythonServiceFromPull, runQueryCmrFromPull } from '../service/service-runner';
import sleep from '../../../../app/util/sleep';

const timeout = 3_000; // Wait up to 3 seconds for the server to start sending
const activeSocketKeepAlive = 6_000;
const maxSockets = 1;
const maxFreeSockets = 1;
const maxRetries = 3;
let pullCounter = 0;
// how many pulls to execute before logging - used to keep log message count reasonable
const pullLogPeriod = 10;

const keepaliveAgent = new Agent({
  keepAlive: true,
  maxSockets,
  maxFreeSockets,
  timeout: activeSocketKeepAlive, // active socket keepalive for 60 seconds
  freeSocketTimeout: timeout, // free socket keepalive for 30 seconds
});

const workUrl = `http://${env.backendHost}:${env.backendPort}/service/work`;
logger.debug(`WORK URL: ${workUrl}`);
logger.debug(`HARMONY_SERVICE: ${sanitizeImage(env.harmonyService)}`);
logger.debug(`INVOCATION_ARGS: ${env.invocationArgs}`);

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

    // 404s are expected when no work is available
    if (response.status === 404) {
      return { status: response.status };
    }

    return { item: response.data, status: response.status };
  } catch (err) {
    if (err.response) {
      return { status: err.response.status, error: err.response.data };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Call a service to perform some work
 *
 * @param workItem - the work to be done
 */
async function _doWork(
  workItem: WorkItem,
): Promise<WorkItem> {
  const newWorkItem = workItem;
  // work items with a scrollID are only for the query-cmr service
  const workFunc = newWorkItem.scrollID ? runQueryCmrFromPull : runPythonServiceFromPull;
  logger.debug('Calling work function');
  const serviceResponse = await workFunc(newWorkItem);
  logger.debug('Finished work');
  if (serviceResponse.batchCatalogs) {
    newWorkItem.status = WorkItemStatus.SUCCESSFUL;
    newWorkItem.results = serviceResponse.batchCatalogs;
  } else {
    logger.error(`Service failed with error: ${serviceResponse.error}`);
    newWorkItem.status = WorkItemStatus.FAILED;
    newWorkItem.errorMessage = `${serviceResponse.error}`;
  }

  return newWorkItem;
}

/**
 * Pull work and execute it
 * @param repeat - if true the function will loop forever (added for testing purposes)
 */
async function _pullAndDoWork(repeat = true): Promise<void> {
  try {
    pullCounter += 1;
    if (pullCounter === pullLogPeriod) {
      logger.debug('Polling for work');
      pullCounter = 0;
    }

    const work = await _pullWork();
    if (!work.error) {
      if (work.item) {
        const workItem = await _doWork(work.item);
        // call back to Harmony to mark the work unit as complete or failed
        logger.debug(`Sending response to Harmony for results of work item with id ${workItem.id} for job id ${workItem.jobID}`);
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
            if ('response' in e && 'status' in e.response) {
              if (e.response.status === 409) {
                logger.warn(`Harmony callback failed with ${e.response.status}: ${e.response.data}`);
                complete = true;
              }
            } else {
              logger.error(e);
            }
          }
          if (!complete) {
            if (tries < maxRetries) {
              logger.info(`Retrying failure to update work item with id ${workItem.id} for job id ${workItem.jobID}`);
              await sleep(1000);
            } else {
              logger.error(`Failed to update work item with id ${workItem.id} for job id ${workItem.jobID}`);
            }
          }
        }
      }
    } else if (work.error === `timeout of ${timeout}ms exceeded`) {
      // timeouts are expected - just try again after a short delay
      logger.debug('Polling timeout - retrying');
    } else if (work.status !== 404) {
      // something bad happened
      logger.error(`Full details: ${JSON.stringify(work)}`);
      logger.error(`Unexpected error while pulling work: ${work.error}`);
      await sleep(3000);
    }
  } catch (e) {
    logger.error(e.message);
  } finally {
    if (repeat) {
      setTimeout(_pullAndDoWork, 500);
    }
  }
}

/**
 * Call the sidecar query-cmr service once to get around a k8s client bug
 * only exported so we can spy during testing
 */
async function _primeCmrService(): Promise<void> {
  const exampleWorkItemProps = {
    jobID: '1',
    serviceID: 'harmony-services/query-cmr:latest',
    status: WorkItemStatus.READY,
    workflowStepIndex: 0,
    operation: { requestId: 'abc' },
    scrollID: '1234',
  } as WorkItemRecord;

  runQueryCmrFromPull(new WorkItem(exampleWorkItemProps)).catch((e) => {
    logger.error('Failed to prime service');
    throw e;
  });
}

/**
 * Call the sidecar service once to get around a k8s client bug
 */
async function _primeService(): Promise<void> {
  const exampleWorkItemProps = {
    jobID: '1',
    serviceID: 'harmony-services/query-cmr:latest',
    status: WorkItemStatus.READY,
    workflowStepIndex: 0,
    operation: { requestId: 'abc' },
  } as WorkItemRecord;

  runPythonServiceFromPull(new WorkItem(exampleWorkItemProps)).catch((e) => {
    logger.error('Failed to prime service');
    throw e;
  });
}

export const exportedForTesting = {
  _pullWork,
  _doWork,
  _pullAndDoWork,
  _primeCmrService,
  _primeService,
};

export default class PullWorker implements Worker {
  async start(repeat = true): Promise<void> {
    // workaround for k8s client bug https://github.com/kubernetes-client/javascript/issues/714
    if (env.harmonyService.includes('harmonyservices/query-cmr')) {
      // called this way to support sinon spy
      await exportedForTesting._primeCmrService();
    } else {
      // called this way to support sinon spy
      await exportedForTesting._primeService();
    }

    // poll the Harmony work endpoint
    _pullAndDoWork(repeat).catch((e) => {
      logger.error(e.message);
    });
  }
}
