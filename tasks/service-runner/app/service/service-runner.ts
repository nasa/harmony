import * as k8s from '@kubernetes/client-node';
import stream from 'stream';
import { sanitizeImage } from '../../../../app/util/string';
import env from '../util/env';
import logger from '../../../../app/util/log';
import { objectStoreForProtocol } from '../../../../app/util/object-store';
import { WorkItemRecord } from '../../../../app/models/work-item-interface';
import axios from 'axios';

const s3 = objectStoreForProtocol('s3');
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const exec = new k8s.Exec(kc);

export interface ServiceResponse {
  batchCatalogs?: string[];
  totalGranulesSize?: number;
  error?: string;
}

// how long to let a worker run before giving up
const { workerTimeout } = env;

class LogStream extends stream.Writable {
  logStr = '';

  shouldLog = true;

  _write(chunk, enc: BufferEncoding, next: (error?: Error | null) => void): void {
    const chunkStr = chunk.toString('utf8');
    this.logStr += chunkStr;
    if (this.shouldLog) {
      logger.debug(chunkStr, { worker: true });
    }
    next();
  }
}

/**
 * Get a list of full s3 paths to each STAC catalog found in an S3 directory.
 * @param dir - the s3 path, e.g. s3://stac/requestId/workItemId/outputs
 */
async function _getStacCatalogs(dir: string): Promise<string[]> {
  return (await s3.listObjectKeys(dir))
    .filter((fileKey) => fileKey.match(/catalog\d*.json/))
    .map((fileKey) => `${env.hostVolumePath}/${fileKey}`);
}

/**
 * Parse an error message out of an error log. First check for error.json, and
 * extract the message from the entry there. Otherwise, parse the full STDOUT
 * error logs for any ERROR level message. Note, the current regular expression
 * for the latter option has issues handling error messages containing curly
 * braces.
 *
 * @param logStr - A string that contains error logging
 * @param catalogDir - A string path for the outputs directory of the WorkItem.
 * @returns An error message parsed from the log
 */
async function _getErrorMessage(logStr: string, catalogDir: string): Promise<string> {
  // expect JSON logs entries
  try {
    const errorFile = `${catalogDir}/error.json`;
    if (await s3.objectExists(errorFile)) {
      const objResponse = await s3.getObject(errorFile).promise();
      const errorFileString = objResponse.Body.toString('utf-8');
      const logEntry = JSON.parse(errorFileString);
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
  const catalogDir = `${env.hostVolumePath}/${operation.requestId}/${workItem.id}/outputs`;

  return new Promise<ServiceResponse>(async (resolve) => {
    logger.debug('CALLING WORKER');

    try {
      const resp = await axios.post(`http://localhost:${env.workerPort}/work`,
        {
          outputDir: catalogDir,
          harmonyInput: `${JSON.stringify(operation)}`,
          scrollId: scrollID,
          maxCmrGranules,
        },
        {
          timeout: workerTimeout,
        },
      );

      if (resp.status < 300) {
        const catalogs = await _getStacCatalogs(`${catalogDir}`);
        const { totalGranulesSize } = resp.data;

        resolve({ batchCatalogs: catalogs, totalGranulesSize });
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
 * Run a service for a work item pulled from Harmony
 * @param operation - The requested operation
 * @param callback - Function to call with result
 */
export async function runServiceFromPull(workItem: WorkItemRecord): Promise<ServiceResponse> {
  try {
    const { operation, stacCatalogLocation } = workItem;
    // support invocation args specified with newline separator or space separator
    let commandLine = env.invocationArgs.split('\n');
    if (commandLine.length == 1) {
      commandLine = env.invocationArgs.split(' ');
    }

    const catalogDir = `${env.hostVolumePath}/${operation.requestId}/${workItem.id}/outputs`;

    return await new Promise<ServiceResponse>((resolve) => {
      logger.debug(`CALLING WORKER for pod ${env.myPodName}`);
      // create a writable stream to capture stdout from the exec call
      // using stdout instead of stderr because the service library seems to log ERROR to stdout
      const stdOut = new LogStream();
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
            if (status.status === 'Success') {
              clearTimeout(timeout);
              logger.debug('Getting STAC catalogs');
              const catalogs = await _getStacCatalogs(`${catalogDir}`);
              resolve({ batchCatalogs: catalogs });
            } else {
              clearTimeout(timeout);
              const logErr = await _getErrorMessage(stdOut.logStr, catalogDir);
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
