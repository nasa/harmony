import { Worker } from '../../../../app/workers/worker';
import { sanitizeImage } from '../../../../app/util/string';
import env from '../util/env';
import { WorkItemRecord, WorkItemStatus } from '../../../../app/models/work-item-interface';
import logger from '../../../../app/util/log';
import { runServiceFromPull, runQueryCmrFromPull } from '../service/service-runner';
import sleep from '../../../../app/util/sleep';
import createAxiosClientWithRetry from '../util/axios-clients';
import path from 'path';
import { existsSync, rmSync, promises as fs } from 'fs';
import { exit } from 'process';

// Poll every 500 ms for now. Potentially make this a configuration item.
const pollingInterval = 500;

// Create axios clients with custom retry settings.
// calculatedDelayMs ~= (2^(retryNumber + exponentialOffset)) * 100
// retryNumber = 1, 2, ..., maxRetries
// e.g. with maxRetries = 10, exponentialOffset = 3, maxDelayMs = 60_000 the delays in ms are roughly:
// [(2^(1+3))*100=1_600, (2^(2+3))*100=3_200, 6_400, 12_800, 25_600, 51_200, 60_000, 60_000, 60_000, 60_000]
// (ms = milliseconds. Actual delay will differ by a small random amount of ms that gets added to each delay.)
const { maxPutWorkRetries } = env;
const maxGetWorkRetries = Number.MAX_SAFE_INTEGER;
const maxDelayMs = 60_000; // delay subsequent retries for up to 1 minute
const exponentialOffset = 3; // offsets the exponent so that initial retries don't happen too soon
const axiosGetWork = createAxiosClientWithRetry(maxGetWorkRetries, maxDelayMs, exponentialOffset);
const axiosUpdateWork = createAxiosClientWithRetry(maxPutWorkRetries, maxDelayMs, exponentialOffset);

let pullCounter = 0;
// how many pulls to execute before logging - used to keep log message count reasonable
const pullLogPeriod = 10;

const WORK_DIR = '/tmp';
const LOCKFILE_DIR = WORK_DIR;

// retry twice for tests and 1200 (2 minutes) for real
const maxPrimeRetries = process.env.NODE_ENV === 'test' ? 2 : 1_200;

const workUrl = `http://${env.backendHost}:${env.backendPort}/service/work`;
logger.debug(`WORK URL: ${workUrl}`);
logger.debug(`HARMONY_SERVICE: ${sanitizeImage(env.harmonyService)}`);
logger.debug(`INVOCATION_ARGS: ${env.invocationArgs}`);

/**
 * Requests work items from Harmony
 */
async function _pullWork(): Promise<{ item?: WorkItemRecord; status?: number; error?: string, maxCmrGranules?: number }> {
  try {
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
      return { status: response.status };
    }

    return { item: response.data.workItem, maxCmrGranules: response.data.maxCmrGranules, status: response.status };
  } catch (err) {
    if (err.response) {
      return { status: err.response.status, error: err.response.data };
    }
    return { status: 500, error: err.message };
  }
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
 */
async function _doWork(
  workItem: WorkItemRecord,
  maxCmrGranules: number,
): Promise<WorkItemRecord> {
  const newWorkItem = workItem;
  // work items with a scrollID are only for the query-cmr service
  const workFunc = newWorkItem.scrollID ? runQueryCmrFromPull : runServiceFromPull;
  logger.debug('Calling work function');
  const serviceResponse = await workFunc(newWorkItem, maxCmrGranules);
  logger.debug('Finished work');
  if (serviceResponse.scrollID) {
    newWorkItem.scrollID = serviceResponse.scrollID;
    newWorkItem.hits = serviceResponse.hits;
  }
  if (serviceResponse.batchCatalogs) {
    newWorkItem.status = WorkItemStatus.SUCCESSFUL;
    newWorkItem.results = serviceResponse.batchCatalogs;
    newWorkItem.totalGranulesSize = serviceResponse.totalGranulesSize;
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
    // remove any previous work items to prevent the pod from running out of disk space
    const regex = /^(?!WORKING|TERMINATING)([a-z0-9]+)$/;
    await emptyDirectory(WORK_DIR, regex);
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
    logger.debug('Polling for work');
    if (pullCounter === pullLogPeriod) {
      pullCounter = 0;
    }

    const work = await _pullWork();
    if (!work.error && work.item) {
      logger.debug(`Performing work for work item with id ${work.item.id} for job id ${work.item.jobID}`);
      const workItem = await _doWork(work.item, work.maxCmrGranules);
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
      setTimeout(_pullAndDoWork, pollingInterval);
    }
  }
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

  runServiceFromPull(exampleWorkItemProps).catch((e) => {
    logger.error('Failed to prime service');
    throw e;
  });
}

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
          await sleep(100);
        }
      }
    }
    // poll the Harmony work endpoint
    _pullAndDoWork(repeat).catch((e) => {
      logger.error(e.message);
    });
  }
}
