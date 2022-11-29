import * as k8s from '@kubernetes/client-node';
import stream from 'stream';
import { sanitizeImage } from '../../../../app/util/string';
import env from '../util/env';
import defaultLogger from '../../../../app/util/log';
import { resolve as resolveUrl } from '../../../../app/util/url';
import { objectStoreForProtocol } from '../../../../app/util/object-store';
import { WorkItemRecord, getStacLocation, getItemLogsLocation } from '../../../../app/models/work-item-interface';
import axios from 'axios';
import { Logger } from 'winston';
import { ManagedUpload } from 'aws-sdk/clients/s3';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const exec = new k8s.Exec(kc);

export interface ServiceResponse {
  batchCatalogs?: string[];
  totalItemsSize?: number;
  outputItemSizes?: number[];
  error?: string;
  hits?: number;
  scrollID?: string;
}

// how long to let a worker run before giving up
const { workerTimeout } = env;

/**
 * A writable stream that is passed to the k8s exec call for the worker container.
 * Captures, logs and stores the logs of the worker container's execution.
 */
export class LogStream extends stream.Writable {
  
  // logs each chunk received
  streamLogger: Logger;

  // all of the logs (JSON or text) that are written
  // to this stream (gets uploaded to s3)
  logStrArr: (string | object)[] = [];
  
  aggregateLogStr = '';

  workItemId;

  /**
   * Build a LogStream instance.
   * @param streamLogger - the logger to log messages with
   */
  constructor(streamLogger = defaultLogger) {
    super();
    this.streamLogger = streamLogger;
  }

  /**
   * Write a chunk to the log stream.
   * @param chunk - the chunk received by the stream (likely a Buffer)
   */
  _write(chunk, enc: BufferEncoding, next: (error?: Error | null) => void): void {
    const logStr: string = chunk.toString('utf8');
    this._handleLogString(logStr);
    next();
  }

  /**
   * Parse the log chunk (if JSON), push it to the logs array, and log it.
   * @param logStr - the string to log (could emanate from a text or JSON logger) 
   */
  _handleLogString(logStr: string): void {
    this.aggregateLogStr += logStr;
    try {
      const logObj: object = JSON.parse(logStr);
      this.logStrArr.push(logObj);
      for (const propertyName of ['timestamp', 'level']) {
        if (propertyName in logObj) {
          const upperCasedPropName = propertyName[0].toUpperCase() + propertyName.substring(1);
          logObj[`worker${upperCasedPropName}`] = logObj[propertyName];
          delete logObj[propertyName];
        }
      }
      this.streamLogger.debug({ ...logObj, worker: true });
    } catch (e) {
      if (e instanceof SyntaxError) { // string log
        this.logStrArr.push(logStr);
        this.streamLogger.debug(logStr, { worker: true });
      }
    }
  }
}

/**
 * Get a list of full s3 paths to each STAC catalog found in an S3 directory.
 * @param dir - the s3 directory url where the catalogs are located
 */
async function _getStacCatalogs(dir: string): Promise<string[]> {
  const s3 = objectStoreForProtocol('s3');
  return (await s3.listObjectKeys(dir))
    .filter((fileKey) => fileKey.match(/catalog\d*.json/))
    .map((fileKey) => `s3://${env.artifactBucket}/${fileKey}`);
}

/**
 * Parse an error message out of an error log. First check for error.json, and
 * extract the message from the entry there. Otherwise, parse the full STDOUT
 * error logs for any ERROR level message. Note, the current regular expression
 * for the latter option has issues handling error messages containing curly
 * braces.
 *
 * @param logStr - A string that contains error logging
 * @param catalogDir - A string path for the outputs directory of the WorkItem 
 * (e.g. s3://artifacts/requestId/workItemId/outputs/).
 * @param logger - Logger for logging messages
 * @returns An error message parsed from the log
 */
async function _getErrorMessage(logStr: string, catalogDir: string, logger: Logger): Promise<string> {
  // expect JSON logs entries
  try {
    const s3 = objectStoreForProtocol('s3');
    const errorFile = resolveUrl(catalogDir, 'error.json');
    if (await s3.objectExists(errorFile)) {
      const logEntry = await s3.getObjectJson(errorFile);
      return logEntry.error;
    }

    const regex = /\{.*?\}/gs;
    const matches = logStr?.match(regex) || [];
    for (const match of matches) {
      const logEntry = JSON.parse(match);
      if (logEntry.level?.toUpperCase() === 'ERROR') {
        return logEntry.message;
      }
    }
    return 'Unknown error';
  } catch (e) {
    logger.error(e.message);
    return e.message;
  }
}

/**
 * Run the query cmr service for a work item pulled from Harmony
  * @param operation - The requested operation
  * @param callback - Function to call with result
  * @param maxCmrGranules - Limits the page of granules in the query-cmr task
  */
export async function runQueryCmrFromPull(workItem: WorkItemRecord, maxCmrGranules?: number): Promise<ServiceResponse> {
  const { operation, scrollID } = workItem;
  const catalogDir = getStacLocation(workItem);
  const logger = defaultLogger.child({ workItemId: workItem.id });
  return new Promise<ServiceResponse>(async (resolve) => {
    logger.debug('CALLING WORKER');
    logger.debug(`maxCmrGranules = ${maxCmrGranules}`);

    try {
      const resp = await axios.post(`http://localhost:${env.workerPort}/work`,
        {
          outputDir: catalogDir,
          harmonyInput: operation,
          scrollId: scrollID,
          maxCmrGranules,
          workItemId: workItem.id,
        },
        {
          timeout: workerTimeout,
        },
      );

      if (resp.status < 300) {
        const catalogs = await _getStacCatalogs(catalogDir);
        const { totalItemsSize, outputItemSizes } = resp.data;
        const newScrollID = resp.data.scrollID;

        resolve({ batchCatalogs: catalogs, totalItemsSize, outputItemSizes, scrollID: newScrollID });
      } else {
        resolve({ error: resp.statusText });
      }
    } catch (e) {
      logger.error(e);
      const message = e.response?.data ? e.response.data.description : e.message;
      resolve({ error: message });
    }
  });

}

/**
 * Write logs from the work item execution to s3
 * @param workItem - the work item that the logs are for
 * @param logs - logs array from the k8s exec call
 */
export async function uploadLogs(workItem: WorkItemRecord, logs: (string | object)[]): Promise<ManagedUpload.SendData> {
  let newFileContent;
  const retryMessage = `Start of service execution (retryCount=${workItem.retryCount}, id=${workItem.id})`;
  if (logs.length > 0 && (typeof logs[0] === 'string' || logs[0] instanceof String)) {
    newFileContent = [retryMessage, ...logs];
  } else {
    newFileContent = [{ message: retryMessage }, ...logs];
  }
  const s3 = objectStoreForProtocol('s3');
  const logsLocation = getItemLogsLocation(workItem);
  if (await s3.objectExists(logsLocation)) { // append to existing logs
    const oldFileContent = await s3.getObjectJson(logsLocation);
    newFileContent = [...oldFileContent, ...newFileContent];
  }
  return s3.upload(JSON.stringify(newFileContent), logsLocation);
}

/**
 * Run a service for a work item pulled from Harmony
 * @param operation - The requested operation
 * @param callback - Function to call with result
 */
export async function runServiceFromPull(workItem: WorkItemRecord): Promise<ServiceResponse> {
  try {
    const { operation, stacCatalogLocation } = workItem;
    const logger = defaultLogger.child({ workItemId: workItem.id });
    // support invocation args specified with newline separator or space separator
    let commandLine = env.invocationArgs.split('\n');
    if (commandLine.length == 1) {
      commandLine = env.invocationArgs.split(' ');
    }

    const catalogDir = getStacLocation(workItem);
    return await new Promise<ServiceResponse>((resolve) => {
      logger.debug(`CALLING WORKER for pod ${env.myPodName}`);
      // create a writable stream to capture stdout from the exec call
      // using stdout instead of stderr because the service library seems to log ERROR to stdout
      const stdOut = new LogStream(logger);
      // timeout if things take too long
      const timeout = setTimeout(async () => {
        resolve({ error: `Worker timed out after ${workerTimeout / 1000.0} seconds` });
      }, workerTimeout);

      exec.exec(
        'harmony',
        env.myPodName,
        'worker',
        [
          ...commandLine,
          '--harmony-action',
          'invoke',
          '--harmony-input',
          `${JSON.stringify(operation)}`,
          '--harmony-sources',
          stacCatalogLocation,
          '--harmony-metadata-dir',
          `${catalogDir}`,
        ],
        stdOut,
        process.stderr as stream.Writable,
        process.stdin as stream.Readable,
        true,
        async (status: k8s.V1Status) => {
          logger.debug(`SIDECAR STATUS: ${JSON.stringify(status, null, 2)}`);
          try {
            await uploadLogs(workItem, stdOut.logStrArr);
            if (status.status === 'Success') {
              clearTimeout(timeout);
              logger.debug('Getting STAC catalogs');
              const catalogs = await _getStacCatalogs(catalogDir);
              resolve({ batchCatalogs: catalogs });
            } else {
              clearTimeout(timeout);
              const logErr = await _getErrorMessage(stdOut.aggregateLogStr, catalogDir, logger);
              const errMsg = `${sanitizeImage(env.harmonyService)}: ${logErr}`;
              resolve({ error: errMsg });
            }
          } catch (e) {
            resolve({ error: e.message });
          }
        },
      ).catch((e) => {
        clearTimeout(timeout);
        logger.error(e.message);
        resolve({ error: e.message });
      });
    });
  } catch (e) {
    return { error: e.message };
  }
}

export const exportedForTesting = {
  _getStacCatalogs,
  _getErrorMessage,
};
