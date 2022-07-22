import * as k8s from '@kubernetes/client-node';
import { existsSync, readdirSync, readFileSync } from 'fs';
import stream from 'stream';
import { sanitizeImage } from '../../../../app/util/string';
import env from '../util/env';
import logger from '../../../../app/util/log';
import { WorkItemRecord } from '../../../../app/models/work-item-interface';
import axios from 'axios';

// Must match where harmony expects artifacts in workflow-orchestration.ts
const ARTIFACT_DIRECTORY = '/tmp/metadata';
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const exec = new k8s.Exec(kc);

export interface ServiceResponse {
  batchCatalogs?: string[];
  totalGranulesSize?: number;
  error?: string;
  scrollID?: string;
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
 * Get a list of STAC catalog in a directory
 * @param dir - the directory containing the catalogs
 */
function _getStacCatalogs(dir: string): string[] {
  // readdirSync should be ok since a service only ever handles one WorkItem at a time and may
  // actually be necessary to ensure read after write consistency on EFS
  return readdirSync(dir)
    .filter((fileName) => fileName.match(/catalog\d*.json/))
    .map((fileName) => `${dir}/${fileName}`);
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
function _getErrorMessage(logStr: string, catalogDir: string): string {
  // expect JSON logs entries
  try {
    const errorFile = `${catalogDir}/error.json`;
    if (existsSync(errorFile)) {
      const logEntry = JSON.parse(readFileSync(errorFile).toString());
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
  const catalogDir = `${ARTIFACT_DIRECTORY}/${operation.requestId}/${workItem.id}/outputs`;

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
        const catalogs = _getStacCatalogs(`${catalogDir}`);
        const { totalGranulesSize } = resp.data;
        const newScrollID = resp.data.scrollID;

        resolve({ batchCatalogs: catalogs, totalGranulesSize, scrollID: newScrollID });
      } else {
        resolve({ error: resp.statusText });
      }
    } catch (e) {
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

    const catalogDir = `${ARTIFACT_DIRECTORY}/${operation.requestId}/${workItem.id}/outputs`;

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
        (status: k8s.V1Status) => {
          logger.debug(`SIDECAR STATUS: ${JSON.stringify(status, null, 2)}`);
          try {
            if (status.status === 'Success') {
              clearTimeout(timeout);
              logger.debug('Getting STAC catalogs');
              const catalogs = _getStacCatalogs(`${catalogDir}`);
              resolve({ batchCatalogs: catalogs });
            } else {
              clearTimeout(timeout);
              const logErr = _getErrorMessage(stdOut.logStr, catalogDir);
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
