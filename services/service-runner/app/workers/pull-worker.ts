import axios, { AxiosError } from 'axios';
import { accessSync, constants, existsSync, promises as fs, rmSync } from 'fs';
import path from 'path';
import { exit } from 'process';

import { sanitizeImage } from '@harmony/util/string';

import { WorkItemRecord, WorkItemStatus } from '../../../harmony/app/models/work-item-interface';
import logger from '../../../harmony/app/util/log';
import { Worker } from '../../../harmony/app/workers/worker';
import { runQueryCmrFromPull, runServiceFromPull } from '../service/service-runner';
import createAxiosClientWithRetry, {
  calculateExponentialDelay, isRetryable,
} from '../util/axios-clients';
import env from '../util/env';
import { sleepCheck } from '../util/sleep-check';

const workingFilePath = path.join(env.workingDir, 'WORKING');

/**
 * Check to see if there is a file in /tmp called TERMINATING, which indicates that k8s is trying
 * to terminate the pod.
 * @returns true if the `TERMINATING` file exists
 */
function isTerminating(): boolean {
  const terminationFilePath = path.join(env.workingDir, 'TERMINATING');
  try {
    accessSync(terminationFilePath, constants.F_OK);
    return true;
  } catch (e) { }

  return false;
}

/**
 * Retries axios connection errors using default retry logic unless the pod is being terminated
 * in which case it exits out early
 *
 * @param error - the axios error returned by the failed request
 * Returns true if the error can be retried and the pod is not being terminated, false otherwise
 */
function retryUnlessTerminating(error: AxiosError): boolean {
  if (isTerminating()) {
    logger.warn('Pod termination requested, will not retry');
    return false;
  }
  return isRetryable(error);
}

// Poll every 500 ms for now. Potentially make this a configuration item.
const pollingInterval = 500;
const { maxPutWorkRetries } = env;
const maxGetWorkRetries = Number.MAX_SAFE_INTEGER;
const maxDelayMs = 60_000; // delay subsequent retries for up to 1 minute
const exponentialOffset = 3; // offsets the exponent so that initial retries don't happen too soon
// we will handle retries ourself when polling for work so that we can check for termination while sleeping
const axiosGetWork = axios.create();
// we don't want to terminate even while sleeping when it comes to retries during work updates, so we
// can use the built-in axios retry
const axiosUpdateWork = createAxiosClientWithRetry(maxPutWorkRetries, maxDelayMs, exponentialOffset);

// this debug statement works around a test failure in Bamboo
console.log(`NODE_ENV = ${process.env.NODE_ENV}`);
// retry twice for tests and 1200 (2 minutes) for real
const maxPrimeRetries = process.env.NODE_ENV === 'test' ? 2 : 1_200;
const protocol = env.backendHost === 'harmony' || env.backendHost === 'host.docker.internal' ? 'http' : 'https';
const workUrl = `${protocol}://${env.backendHost}:${env.backendPort}/service/work`;
logger.debug(`WORK URL: ${workUrl}`);
logger.debug(`HARMONY_SERVICE: ${sanitizeImage(env.harmonyService)}`);
logger.debug(`INVOCATION_ARGS: ${env.invocationArgs}`);

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

  runServiceFromPull(exampleWorkItemProps).catch((e) => {
    logger.error('Failed to prime service');
    throw e;
  });
}

/**
 * Requests work items from Harmony
 */
async function _pullWork(): Promise<{ item?: WorkItemRecord; status?: number; error?: string, maxCmrGranules?: number; }> {
  let retries = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: { item?: any, status: number, error?: string, maxCmrGranules?: number; };
  while (!result && retries <= maxGetWorkRetries) {
    retries += 1;
    try {
      // write out the WORKING file to prevent pod termination while working
      await fs.writeFile(workingFilePath, '1');

      const response = await axiosGetWork
        .get(workUrl, {
          params: { serviceID: env.harmonyService, podName: env.myPodName },
          responseType: 'json',
          validateStatus(status) {
            return status === 404 || (status >= 200 && status < 400);
          },
        });

      // 404s are expected when no work is available
      if (response.status === 404) {
        result = { status: response.status };
      } else {
        const item = response.data.workItem;
        result = { item, maxCmrGranules: response.data.maxCmrGranules, status: response.status };
      }

    } catch (err) {
      if (!isRetryable(err) || !retryUnlessTerminating(err) || retries > maxGetWorkRetries) {
        if (err.response) {
          result = { status: err.response.status, error: err.response.data };
        } else {
          result = { status: 500, error: err.message };
        }
      }
    }

    if (!result) {
      // remove the WORKING file while we sleep so the pod can be terminated if need be
      try {
        await fs.unlink(workingFilePath);
      } catch {
        // log this, but don't let it stop things
        logger.error('Failed to delete /tmp/WORKING');
      }

      const delay = calculateExponentialDelay(retries, exponentialOffset, maxDelayMs);
      await sleepCheck(delay, isTerminating);
      if (isTerminating()) {
        logger.debug('Pod is terminating');
        exit(0);
      }
    }
  }

  return result;
}

/**
 * Remove files and subdirectories from a directory, optionally skipping certain files
 *
 * @param directory - the path to the directory to be emptied
 * @param matchingFilter - RegExp matching files/directories that should be deleted
 *
 */
async function emptyDirectory(directory: string, matchingFilter?: RegExp): Promise<void> {
  const regex = matchingFilter || /^.*$/;

  if (existsSync(directory)) {
    const files = await fs.readdir(directory);
    files.filter(f => regex.test(f))
      .map(f => rmSync(path.join(directory, f), { recursive: true, force: true }));

  } else {
    logger.error(`Directory ${directory} not found`);
  }
}


/**
 * Call a service to perform some work
 *
 * @param workItem - the work to be done
 * @param maxCmrGranules - limits the page of granules in the query-cmr task
 * @param workItemLogger - the logger to use
 */
async function _doWork(
  workItem: WorkItemRecord,
  maxCmrGranules: number,
  workItemLogger = logger,
): Promise<WorkItemRecord> {
  const newWorkItem = workItem;
  workItemLogger.debug('Calling work function');
  // work items with a scrollID are only for the query-cmr service
  const serviceResponse = newWorkItem.scrollID ?
    await runQueryCmrFromPull(newWorkItem, maxCmrGranules, workItemLogger) :
    await runServiceFromPull(newWorkItem, workItemLogger);
  workItemLogger.debug('Finished work');
  if (serviceResponse.scrollID) {
    newWorkItem.scrollID = serviceResponse.scrollID;
    newWorkItem.hits = serviceResponse.hits;
  }
  if (serviceResponse.batchCatalogs) {
    newWorkItem.status = WorkItemStatus.SUCCESSFUL;
    newWorkItem.results = serviceResponse.batchCatalogs;
    newWorkItem.totalItemsSize = serviceResponse.totalItemsSize;
    newWorkItem.outputItemSizes = serviceResponse.outputItemSizes;
  } else {
    if (serviceResponse.errorLevel?.toLowerCase() === WorkItemStatus.WARNING.toString()) {
      workItemLogger.warn(`Service succeeded with warning: ${serviceResponse.error}`);
      newWorkItem.status = WorkItemStatus.WARNING;
      newWorkItem.message = serviceResponse.error;
      newWorkItem.message_category = serviceResponse.errorCategory;
    } else {
      workItemLogger.error(`Service failed with error: ${serviceResponse.error}`);
      newWorkItem.status = WorkItemStatus.FAILED;
      newWorkItem.message = serviceResponse.error;
      newWorkItem.message_category = serviceResponse.errorCategory;
    }
  }

  return newWorkItem;
}


/**
 * Pull work and execute it
 * @param repeat - if true the function will loop forever (added for testing purposes)
 */
async function _pullAndDoWork(repeat = true): Promise<void> {
  try {
    // remove any previous work items to prevent the pod from running out of disk space
    const regex = /^(?!WORKING|TERMINATING)(.+)$/;
    await emptyDirectory(env.workingDir, regex);
  } catch (e) {
    // We'll continue on even if we have issues cleaning up - it just means the pod may end
    // up being evicted at some point due to running out of ephemeral storage space
    logger.error(`Error cleaning up working directory ${env.workingDir}`);
    logger.error(e);
  }

  try {
    // check to see if we are terminating
    if (isTerminating()) {
      logger.warn('Received TERMINATION request, no longer processing work');
      exit(0);
    }

    logger.debug('Polling for work');
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const work = await exportedForTesting._pullWork();
    if (!work.error && work.item) {
      const startTime = Date.now();
      const workItemLogger = logger.child({ workItemId: work.item.id });
      workItemLogger.debug(`Performing work for work item with id ${work.item.id} for job id ${work.item.jobID}`);
      const workItem = await _doWork(work.item, work.maxCmrGranules, workItemLogger);
      workItem.duration = Date.now() - startTime;
      // call back to Harmony to mark the work unit as complete or failed
      workItemLogger.debug(`Sending response to Harmony for results of work item with id ${workItem.id} for job id ${workItem.jobID}`);

      // don't need to send variables back
      for (const source of workItem.operation.sources) {
        source.variables = [];
      }

      try {
        await axiosUpdateWork.put(`${workUrl}/${workItem.id}`, workItem);
      } catch (e) {
        const status = e.response?.status;
        if (status) {
          if (status === 409) {
            workItemLogger.warn(`Harmony callback failed with ${e.response.status}: ${e.response.data}`);
          } else if (status >= 400) {
            workItemLogger.error(`Error: received status [${status}] with message [${e.response.data}] when updating WorkItem ${workItem.id}`);
            workItemLogger.error(`Error: ${e.response.statusText}`);
          }
        } else {
          workItemLogger.error(e);
        }
      }
    } else if (work.status !== 404) {
      // something bad happened
      logger.error(`Full details: ${JSON.stringify(work)}`);
      logger.error(`Unexpected error while pulling work: ${work.error}`);
      await sleepCheck(3000, isTerminating);
    }
  } catch (e) {
    logger.error(e);
  } finally {
    // remove the WORKING file
    try {
      await fs.unlink(workingFilePath);
    } catch {
      // log this, but don't let it stop things
      logger.error('Failed to delete /tmp/WORKING');
    }
    if (repeat && !isTerminating()) {
      setTimeout(_pullAndDoWork, pollingInterval);
    }
  }
}

/**
 * Used to make functions available for testing and mocking
 *
 */
export const exportedForTesting = {
  _pullWork,
  _doWork,
  _pullAndDoWork,
  _primeService,
  axiosGetWork,
  axiosUpdateWork,
};

export default class PullWorker implements Worker {
  async start(repeat = true): Promise<void> {
    // workaround for k8s client bug https://github.com/kubernetes-client/javascript/issues/714
    let isPrimed = false;
    let primeCount = 0;
    while (!isPrimed && primeCount < maxPrimeRetries) {
      try {
        if (!env.harmonyService.includes('harmonyservices/query-cmr')) {
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
          await sleepCheck(100, () => false);
        }
      }
    }
    // poll the Harmony work endpoint
    _pullAndDoWork(repeat).catch((e) => {
      logger.error(e.message);
    });
  }
}
