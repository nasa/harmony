import { exit } from 'process';
import { Worker } from '../../../../app/workers/worker';
import { sanitizeImage } from '../../../../app/util/string';
import env from '../util/env';
import WorkItem, { WorkItemStatus, WorkItemRecord } from '../../../../app/models/work-item';
import logger from '../../../../app/util/log';
import { runServiceFromPull, runQueryCmrFromPull } from '../service/service-runner';
import sleep from '../../../../app/util/sleep';
import createAxiosClientWithRetry, { axiosTimeoutMs } from '../util/axios-clients';
import path from 'path';
import { promises as fs } from 'fs';


const axiosGetWork = createAxiosClientWithRetry(Infinity, 90_000, 4);
const axiosUpdateWork = createAxiosClientWithRetry(4, Infinity, 4);

let pullCounter = 0;
// how many pulls to execute before logging - used to keep log message count reasonable
const pullLogPeriod = 10;

const LOCKFILE_DIR = '/tmp';

// retry twice for tests and 1200 (2 minutes) for real
const maxPrimeRetries = process.env.NODE_ENV === 'test' ? 2 : 1_200;

const workUrl = `http://${env.backendHost}:${env.backendPort}/service/work`;
logger.debug(`WORK URL: ${workUrl}`);
logger.debug(`HARMONY_SERVICE: ${sanitizeImage(env.harmonyService)}`);
logger.debug(`INVOCATION_ARGS: ${env.invocationArgs}`);

/**
 * Requests work items from Harmony
 */
async function _pullWork(): Promise<{ item?: WorkItem; status?: number; error?: string }> {
  try {
    const response = await axiosGetWork
      .get(workUrl, {
        params: { serviceID: env.harmonyService },
        responseType: 'json',
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
  const workFunc = newWorkItem.scrollID ? runQueryCmrFromPull : runServiceFromPull;
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
  const workingFilePath = path.join(LOCKFILE_DIR, 'WORKING');
  try {
    // write out the WORKING file to prevent pod termination while working
    await fs.writeFile(workingFilePath, '1');

    // check to see if we are terminating
    const terminationFilePath = path.join(LOCKFILE_DIR, 'TERMINATING');
    try {
      await fs.access(terminationFilePath);
      // TERMINATING file exists so PreStop handler is requesting termination
      logger.debug('RECEIVED TERMINATION REQUEST');
      // removing the WORKING file is done in the `finally` block at the end of this function
      return;
    } catch {
      // expected if file does not exist
    }

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
        try {
          await axiosUpdateWork.put(`${workUrl}/${workItem.id}`, workItem);
        } catch (e) {
          const status = e.response?.status;
          if (status) {
            if (status === 409) {
              logger.warn(`Harmony callback failed with ${e.response.status}: ${e.response.data}`);
            } else if (status >= 400) {
              logger.error(`Error: received status [${status}] with message [${e.response.data}] when updating WorkItem ${workItem.id}`);
              logger.error(`Error: ${e.response.statusText}`);
            }
          } else {
            logger.error(e);
          }
        }
      }
    } else if (work.error === `timeout of ${axiosTimeoutMs}ms exceeded`) {
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
    // remove the WORKING file
    try {
      await fs.unlink(workingFilePath);
    } catch {
      // log this, but don't let it stop things
      logger.error('Failed to delete /tmp/WORKING');
    }
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

  runServiceFromPull(new WorkItem(exampleWorkItemProps)).catch((e) => {
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
    let isPrimed = false;
    let primeCount = 0;
    while (!isPrimed && primeCount < maxPrimeRetries) {
      try {
        if (env.harmonyService.includes('harmonyservices/query-cmr')) {
          // called this way to support sinon spy
          await exportedForTesting._primeCmrService();
        } else {
          // called this way to support sinon spy
          await exportedForTesting._primeService();
        }
        isPrimed = true;
      } catch (e) {
        primeCount += 1;
        if (primeCount === maxPrimeRetries) {
          logger.error('Failed to prime service');
          // kill this process which will cause the container to get restarted
          exit(1);
        } else {
          // wait 100 ms before trying again
          sleep(100);
        }
      }
    }

    // poll the Harmony work endpoint
    _pullAndDoWork(repeat).catch((e) => {
      logger.error(e.message);
    });
  }
}
