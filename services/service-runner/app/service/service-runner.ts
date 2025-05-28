import axios from 'axios';
import { writeFileSync } from 'fs';
import stream from 'stream';
import { Logger } from 'winston';

import { sanitizeImage } from '@harmony/util/string';
import * as k8s from '@kubernetes/client-node';

import {
  getItemLogsLocation, getStacLocation, WorkItemRecord,
} from '../../../harmony/app/models/work-item-interface';
import logger from '../../../harmony/app/util/log';
import { objectStoreForProtocol } from '../../../harmony/app/util/object-store';
import sleep from '../../../harmony/app/util/sleep';
import { resolve as resolveUrl } from '../../../harmony/app/util/url';
import env from '../util/env';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const exec = new k8s.Exec(kc);

export interface ServiceResponse {
  batchCatalogs?: string[];
  totalItemsSize?: number;
  outputItemSizes?: number[];
  error?: string;
  errorLevel?: 'warning' | 'error';
  errorCategory?: string;
  hits?: number;
  scrollID?: string;
  retryable?: boolean;
}

// how long to let a worker run before giving up
const { workerTimeout } = env;

// service exit code for Out Of Memory error
const OOM_EXIT_CODE = '137';

// maximum size a data operation can be before it must be passed as a file using
// --harmony-input-file <path> instead of passed as a command line argument using
// --harmony-input <operation>
const MAX_INLINE_OPERATION_SIZE = 100000;

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

  /**
   * Build a LogStream instance.
   * @param streamLogger - the logger to log messages with
   */
  constructor(streamLogger = logger) {
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
  // check to see if there is a batch-catalogs.json file and read it if so
  const batchCatalogsJsonUrl = `${dir}batch-catalogs.json`;
  if (await s3.objectExists(batchCatalogsJsonUrl)) {
    const batchCatalogs = await s3.getObjectJson(batchCatalogsJsonUrl) as string[];
    return batchCatalogs.map(filename => `${dir}${filename}`);
  }

  // otherwise retrieve the keys from the bucket that are of the form catalog*.json,
  // and sort them by index number
  const urls = (await s3.listObjectKeys(dir))
    .filter((fileKey) => fileKey.match(/catalog\d*.json$/))
    .map((fileKey) => `s3://${env.artifactBucket}/${fileKey}`);
  const fileNumRegex = /.*catalog(\d+)\.json$/;
  return urls.sort((a, b) => {
    const aMatches = a.match(fileNumRegex);
    const aNum = aMatches.length > 1 ? Number(aMatches[1]) : 0;
    const bMatches = b.match(fileNumRegex);
    const bNum = bMatches.length > 1 ? Number(bMatches[1]) : 0;
    return aNum - bNum;
  });
}

/**
 * Get the error message based on the given status and default error message.
 *
 * @param status - A kubernetes V1Status
 * @param msg - A default error message
 * @returns An error message for the status
 */
function _getErrorMessageOfStatus(status: k8s.V1Status, msg = 'Unknown error'): string {
  const exitCode = status.details?.causes?.find(i => i.reason === 'ExitCode');
  let errorMsg = null;
  if (exitCode?.message === OOM_EXIT_CODE) {
    errorMsg = 'Service failed due to running out of memory';
  }
  return (errorMsg ? errorMsg : msg);
}

/**
 * Get the error information from error.json (if the backend service provided it)
 * or use the k8s status to generate one. This error message
 * is often used to populate the user-facing job's message and errors fields.
 *
 * @param status - A kubernetes V1Status
 * @param catalogDir - A string path for the outputs directory of the WorkItem
 * (e.g. s3://artifacts/requestId/workItemId/outputs/).
 * @param workItemLogger - Logger for logging messages
 * @returns An error message and level and possibly an error category
 */
async function _getErrorInfo(
  status: k8s.V1Status, catalogDir: string, workItemLogger: Logger = logger,
): Promise<{ error: string; level: 'error' | 'warning';  category?: string }> {
  // expect JSON logs entries
  try {
    const s3 = objectStoreForProtocol('s3');
    const errorFile = resolveUrl(catalogDir, 'error.json');
    if (await s3.objectExists(errorFile)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorEntries: any = await s3.getObjectJson(errorFile);
      const { error } = errorEntries;
      const level = errorEntries.level ? errorEntries.level.toLowerCase() : 'error';
      const category = errorEntries.category?.toLowerCase();
      if (category) {
        return { error, level, category };
      }
      return { error, level };
    }
    const error = _getErrorMessageOfStatus(status);
    return { error, level: 'error' };
  } catch (e) {
    workItemLogger.error(`Caught exception: ${e}`);
    workItemLogger.error(`Unable to parse out error from catalog location: ${catalogDir}`);
    const error = _getErrorMessageOfStatus(status, 'Service terminated without error message');
    return { error, level: 'error' };
  }
}

/**
 * Run the query cmr service for a work item pulled from Harmony
  * @param operation - The requested operation
  * @param callback - Function to call with result
  * @param maxCmrGranules - Limits the page of granules in the query-cmr task
  * @param workItemLogger - The logger to use
  */
export async function runQueryCmrFromPull(
  workItem: WorkItemRecord,
  maxCmrGranules?: number,
  workItemLogger = logger,
): Promise<ServiceResponse> {
  workItemLogger.debug(`CALLING WORKER with maxCmrGranules = ${maxCmrGranules}`);
  let response;
  try {
    const { operation, scrollID } = workItem;
    const catalogDir = getStacLocation(workItem);
    response = await axios.post(`http://127.0.0.1:${env.workerPort}/work`,
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
    if (response.status < 300) {
      const { errorCategory } = response.data;
      if (errorCategory === 'granValidation') {
        return response.data;
      }

      const batchCatalogs = await _getStacCatalogs(catalogDir);
      const { totalItemsSize, outputItemSizes } = response.data;
      const newScrollID = response.data.scrollID;
      return { batchCatalogs, totalItemsSize, outputItemSizes, scrollID: newScrollID };
    }
  } catch (e) {
    workItemLogger.error(e);
    if (e.response) {
      ({ response } = e);
    }
  }
  let error = response?.data?.description || '';
  if (!error && (response?.status || response?.statusText)) {
    error = `The Query CMR service responded with status ${response.statusText || response.status}.`;
  }
  return { error };
}

/**
 * Write logs from the work item execution to s3
 * @param workItem - the work item that the logs are for
 * @param logs - logs array from the k8s exec call
 */
export async function uploadLogs(
  workItem: WorkItemRecord, logs: (string | object)[],
): Promise<object> {
  let newFileContent = logs;
  const s3 = objectStoreForProtocol('s3');
  const logsLocation = getItemLogsLocation(workItem);
  if (await s3.objectExists(logsLocation)) { // append to existing logs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldFileContent: any = await s3.getObjectJson(logsLocation);
    newFileContent = [...oldFileContent, ...newFileContent];
  }
  return s3.upload(JSON.stringify(newFileContent), logsLocation);
}

/**
 * Run a service for a work item pulled from Harmony
 * @param workItem - The item to be worked on in the service
 * @param workItemLogger - The logger to use
 */
export async function runServiceFromPull(
  workItem: WorkItemRecord, workItemLogger = logger,
): Promise<ServiceResponse> {
  try {
    const serviceName = sanitizeImage(env.harmonyService);
    const error = `The ${serviceName} service failed.`;
    const { operation, stacCatalogLocation } = workItem;

    // support invocation args specified with newline separator or space separator
    let commandLine = env.invocationArgs.split('\n');
    if (commandLine.length === 1) {
      commandLine = env.invocationArgs.split(' ');
    }

    // if the shape field in the operation is not an object with an `href` field then it must
    // be a string containing the actual geojson. in that case we save it to a file in the shared
    // /tmp directory and replace the `geojson` entry with the file url. Note that operation is
    // not an instance of the DataOperation class, it is an object that matches the JSON schema
    // model so instead of operation.geojson we use operation.subset.shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoJson = (operation as any).subset?.shape;
    if (typeof geoJson === 'string') {
      const geoJsonFile = '/tmp/shapefile.json';
      writeFileSync(geoJsonFile, geoJson);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (operation as any).subset.shape = {
        href: `file://${geoJsonFile}`,
        type: 'application/geo+json',
      };
    }

    const catalogDir = getStacLocation(workItem);

    // create a writable stream to capture stdout from the exec call
    // using stdout instead of stderr because the service library seems to log ERROR to stdout
    const stdOut = new LogStream(workItemLogger);
    const operationJson = JSON.stringify(operation);
    let operationCommandLine = '--harmony-input';
    let operationCommandLineValue = operationJson;

    // 262144 is the max SQS message size, so any operation + other stuff we add that is
    // bigger than that is considered BIG and therefore requires special handling. In this case
    // we use a file to pass the operation to harmony-service-lib instead of a command line
    // argument.
    if (operationJson.length > MAX_INLINE_OPERATION_SIZE) {
      const operationJsonFile = '/tmp/operation.json';
      operationCommandLine = '--harmony-input-file';
      operationCommandLineValue = operationJsonFile;
      writeFileSync(operationJsonFile, operationJson);
    }

    const commandAndArgs = [
      ...commandLine,
      '--harmony-action',
      'invoke',
      operationCommandLine,
      operationCommandLineValue,
      '--harmony-sources',
      stacCatalogLocation,
      '--harmony-metadata-dir',
      catalogDir,
    ];

    let retryCount = 0;
    const maxRetries = 5;
    let retryDelay = 5_000; // time in ms to wait before retrying
    const retryDelayMultiplier = 2.0; // used to increase delay each retry

    while (retryCount < maxRetries) {
      const result: ServiceResponse = await new Promise<ServiceResponse>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ error: `Worker timed out after ${workerTimeout / 1000.0} seconds` });
        }, workerTimeout);

        exec.exec(
          'harmony',
          env.myPodName,
          'worker',
          commandAndArgs,
          stdOut,
          process.stderr as stream.Writable,
          process.stdin as stream.Readable,
          true,
          async (status: k8s.V1Status) => {
            const sidecarMessage = `SIDECAR STATUS: ${JSON.stringify(status, null, 2)}`;
            workItemLogger.debug(sidecarMessage);

            try {
              const retryMessage = `${new Date().toISOString()} Start of service execution (retryCount=${workItem.retryCount}, workItemId=${workItem.id})`;

              const fullCommand = commandAndArgs.join(' ');
              const redactedcommandAndArgs = fullCommand.replace(
                /"accessToken"\s*:\s*"[^"]*"/g,
                '"accessToken":"<redacted>"',
              );

              const debugInfo = [
                `${new Date().toISOString()} ${sidecarMessage}`,
                `COMMAND: ${redactedcommandAndArgs}`,
                `POD: ${env.myPodName}`,
              ];

              if (status.code || status.reason || status.message) {
                debugInfo.push(
                  `STATUS REASON: ${String(status.reason)}`,
                  `STATUS MESSAGE: ${String(status.message)}`,
                  `STATUS CODE: ${String(status.code)}`,
                );
              }

              await uploadLogs(workItem, [retryMessage, debugInfo, ...stdOut.logStrArr]);

              clearTimeout(timeout);

              if (status.status === 'Success') {
                workItemLogger.debug('Getting STAC catalogs');
                const catalogs = await _getStacCatalogs(catalogDir);
                resolve({ batchCatalogs: catalogs });
              } else {
                const errorEntries = await _getErrorInfo(status, catalogDir, workItemLogger);
                const errorMessage = `${serviceName}: ${errorEntries.error}`;
                const errorLevel = errorEntries.level;
                const errorCategory = errorEntries.category;

                if (errorCategory) {
                  resolve({ error: errorMessage, errorLevel, errorCategory });
                } else if (status.code === 500) {
                  // The k8s client hit an error, the worker did not return an error
                  // In this scenario we want to retry internally rather than immediately fail
                  workItemLogger.error('K8s hit an internal error, will attempt to retry until retries are exhausted');
                  resolve({ retryable: true });
                } else {
                  resolve({ error: errorMessage, errorLevel });
                }
              }
            } catch (e) {
              clearTimeout(timeout);
              workItemLogger.error('Caught exception while executing work:');
              workItemLogger.error(e);
              resolve({ error, errorLevel: 'error' });
            }
          },
        ).catch((e) => {
          clearTimeout(timeout);
          workItemLogger.error('Kubernetes client exec caught exception:');
          workItemLogger.error(e);
          resolve({ error, errorLevel: 'error' });
        });
      });

      if ('retryable' in result) {
        retryCount += 1;
        workItemLogger.debug(`Retryable error encountered (attempt ${retryCount} of ${maxRetries})`);
        await sleep(retryDelay);
        retryDelay = retryDelayMultiplier * retryDelay;
      } else {
        return result;
      }
    }

    // All retries were exhausted
    return {
      error: 'Unknown internal server error',
      errorLevel: 'error',
      errorCategory: 'Internal server error',
    };

  } catch (e) {
    workItemLogger.error('runServiceFromPull caught exception:');
    workItemLogger.error(e);
    return { error: 'The service failed.' };
  }
}

export const exportedForTesting = {
  _getStacCatalogs,
  _getErrorInfo: _getErrorInfo,
};
