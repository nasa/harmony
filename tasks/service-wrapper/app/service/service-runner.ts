import * as k8s from '@kubernetes/client-node';
import { readdirSync } from 'fs';
import stream from 'stream';
import env from '../util/env';
import logger from '../../../../app/util/log';
import WorkItem from '../../../../app/models/work-item';

// Must match where harmony expects artifacts in workflow-orchestration.ts
const ARTIFACT_DIRECTORY = '/tmp/metadata';
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const exec = new k8s.Exec(kc);

export interface ServiceResponse {
  batchCatalogs?: string[];
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
      logger.debug(`FROM WORKER LOG: ${chunkStr}`);
    }
    next();
  }
}

/**
 * Get a list of STAC catalog in a directory
 * @param dir - the directory containing the catalogs
 */
function _getStacCatalogs(dir: string): string[] {
  // readdirync should be ok since a service only ever handles one WorkItem at a time and may
  // actually be necessary to ensure read after write consistency on EFS
  return readdirSync(dir)
    .filter((fileName) => fileName.match(/catalog\d*.json/))
    .map((fileName) => `${dir}/${fileName}`);
}

/**
 * Parse an error message out of an error log
 *
 * @param logStr - A string that contains error logging
 * @returns An error message parsed from the log
 */
function _getErrorMessage(logStr: string): string {
  // expect JSON logs entries
  const regex = /\{"message":.*?"application":.*?\}/g;
  const matches = logStr.match(regex);
  for (const match of matches) {
    const logEntry = JSON.parse(match);
    if (logEntry.level === 'ERROR') {
      return logEntry.message;
    }
  }

  return 'Unknown error';
}

/**
 * Run the query cmr service for a work item pulled from Harmony
  * @param operation - The requested operation
  * @param callback - Function to call with result
  */
export function runQueryCmrFromPull(workItem: WorkItem): Promise<ServiceResponse> {
  const { operation, scrollID } = workItem;
  const catalogDir = `${ARTIFACT_DIRECTORY}/${operation.requestId}/${workItem.id}/outputs`;
  const args = [
    'tasks/query-cmr/app/cli',
    '--harmony-input',
    `${JSON.stringify(operation)}`,
    '--scroll-id',
    scrollID,
    '--output-dir',
    catalogDir,
  ];

  return new Promise<ServiceResponse>((resolve) => {
    logger.debug('CALLING WORKER');
    // create a writable stream to capture stdout from the exec call
    // using stdout instead of stderr because the service library seems to log ERROR to stdout
    const stdOut = new LogStream();

    // timeout if things take too long
    const timeout = setTimeout(() => {
      resolve({ error: `Worker timed out after ${workerTimeout / 1000.0} seconds` });
    }, workerTimeout);

    exec.exec(
      'argo',
      env.myPodName,
      'worker',
      [
        'node',
        ...args,
      ],
      stdOut,
      process.stderr as stream.Writable,
      process.stdin as stream.Readable,
      true,
      (status: k8s.V1Status) => {
        logger.debug(`SIDECAR STATUS: ${JSON.stringify(status, null, 2)}`);
        if (status.status === 'Success') {
          clearTimeout(timeout);
          logger.debug('Getting STAC catalogs');
          const catalogs = _getStacCatalogs(`${catalogDir}`);
          resolve({ batchCatalogs: catalogs });
        } else {
          clearTimeout(timeout);
          const logErr = _getErrorMessage(stdOut.logStr);
          const errMsg = `${env.harmonyService}: ${logErr}`;
          resolve({ error: errMsg });
        }
      },
    ).catch((e) => {
      clearTimeout(timeout);
      logger.error(e.message);
      resolve({ error: e.message });
    });
  });
}

/**
 * Run a service for a work item pulled from Harmony
 * @param operation - The requested operation
 * @param callback - Function to call with result
 */
export async function runPythonServiceFromPull(workItem: WorkItem): Promise<ServiceResponse> {
  const { operation, stacCatalogLocation } = workItem;
  const commandLine = env.invocationArgs.split('\n');
  logger.debug(`Working dir: ${env.workingDir}`);

  const catalogDir = `${ARTIFACT_DIRECTORY}/${operation.requestId}/${workItem.id}/outputs`;

  return new Promise<ServiceResponse>((resolve) => {
    logger.debug('CALLING WORKER');
    // create a writable stream to capture stdout from the exec call
    // using stdout instead of stderr because the service library seems to log ERROR to stdout
    const stdOut = new LogStream();
    // timeout if things take too long
    const timeout = setTimeout(async () => {
      resolve({ error: `Worker timed out after ${workerTimeout / 1000.0} seconds` });
    }, workerTimeout);

    exec.exec(
      'argo',
      env.myPodName,
      'worker',
      [
        'python',
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
        if (status.status === 'Success') {
          clearTimeout(timeout);
          logger.debug('Getting STAC catalogs');
          const catalogs = _getStacCatalogs(`${catalogDir}`);
          resolve({ batchCatalogs: catalogs });
        } else {
          clearTimeout(timeout);
          const logErr = _getErrorMessage(stdOut.logStr);
          const errMsg = `${env.harmonyService}: ${logErr}`;
          resolve({ error: errMsg });
        }
      },
    ).catch((e) => {
      clearTimeout(timeout);
      logger.error(e.message);
      resolve({ error: e.message });
    });
  });
}
