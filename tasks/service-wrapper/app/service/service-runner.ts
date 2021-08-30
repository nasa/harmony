import * as k8s from '@kubernetes/client-node';
import { readdirSync } from 'fs';
import stream from 'stream';
import env from '../util/env';
import log from '../util/log';
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
    log.debug('CALLING WORKER');
    // timeout if things take too long
    const timeout = setTimeout(() => {
      resolve({ error: 'Worker timed out' });
    }, workerTimeout);
    try {
      exec.exec(
        'argo',
        env.myPodName,
        'worker',
        [
          'node',
          ...args,
        ],
        process.stdout as stream.Writable,
        process.stderr as stream.Writable,
        process.stdin as stream.Readable,
        true,
        (status: k8s.V1Status) => {
          log.debug(`SIDECAR STATUS: ${JSON.stringify(status, null, 2)}`);
          if (status.status === 'Success') {
            clearTimeout(timeout);
            log.debug('Getting STAC catalogs');
            const catalogs = _getStacCatalogs(`${catalogDir}`);
            resolve({ batchCatalogs: catalogs });
          } else {
            clearTimeout(timeout);
            resolve({ error: status.message });
          }
        },
      );
    } catch (e) {
      clearTimeout(timeout);
      log.error(e.message);
      resolve({ error: e.message });
    }
  });
}

/**
 * Run a service for a work item pulled from Harmony
 * @param operation - The requested operation
 * @param callback - Function to call with result
 */
export function runPythonServiceFromPull(workItem: WorkItem): Promise<ServiceResponse> {
  const { operation, stacCatalogLocation } = workItem;
  const commandLine = env.invocationArgs.split('\n');
  log.debug(`Working dir: ${env.workingDir}`);

  const catalogDir = `${ARTIFACT_DIRECTORY}/${operation.requestId}/${workItem.id}/outputs`;

  return new Promise<ServiceResponse>((resolve) => {
    log.debug('CALLING WORKER');
    // timeout if things take too long
    const timeout = setTimeout(() => {
      resolve({ error: 'Worker timed out' });
    }, workerTimeout);
    try {
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
        process.stdout as stream.Writable,
        process.stderr as stream.Writable,
        process.stdin as stream.Readable,
        true,
        (status: k8s.V1Status) => {
          log.debug(`SIDECAR STATUS: ${JSON.stringify(status, null, 2)}`);
          if (status.status === 'Success') {
            clearTimeout(timeout);
            log.debug('Getting STAC catalogs');
            const catalogs = _getStacCatalogs(`${catalogDir}`);
            resolve({ batchCatalogs: catalogs });
          } else {
            clearTimeout(timeout);
            resolve({ error: status.message });
          }
        },
      );
    } catch (e) {
      clearTimeout(timeout);
      log.error(e.message);
      resolve({ error: e.message });
    }
  });
}
