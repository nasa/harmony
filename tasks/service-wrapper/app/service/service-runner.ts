import * as k8s from '@kubernetes/client-node';
import { PythonShell } from 'python-shell';
import { Response } from 'express';
import { readdirSync } from 'fs';
import { spawn } from 'child_process';
import stream from 'stream';
import env from '../util/env';
import log from '../util/log';
import sem from '../util/semaphore';
import WorkItem from '../../../../app/models/work-item';

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
 * Runs a service request
 *
 * @param operation - The requested operation
 * @param res - The Response to use to reply
 */
export function runServiceForRequest(operation, res: Response): void {
  const kc = new k8s.KubeConfig();
  if (this.cluster) {
    kc.loadFromOptions({
      clusters: [this.cluster],
      contexts: [this.context],
      currentContext: this.context.name,
    });
  } else {
    kc.loadFromDefault();
  }

  const exec = new k8s.Exec(kc);
  exec.exec('argo', env.myPodName, 'worker', 'cd /home && ls', process.stdout, process.stderr, process.stdin, true);

  const options = {
    pythonOptions: ['-u'], // get print results in real-time
    cwd: '/home',
    args: [
      `${env.harmonyService}`,
      '--harmony-action',
      'invoke',
      '--harmony-input',
      `${JSON.stringify(operation)}`,
      '--harmony-sources',
      `/tmp/metadata/${operation.requestId}/inputs/catalog0.json`,
      '--harmony-metadata-dir',
      `/tmp/metadata/${operation.requestId}/outputs`,
    ],
  };

  log.info(`Calling service ${env.harmonyService}`);
  const shell = PythonShell.run('-m', options, (err, results) => {
    if (err) {
      sem.leave();
      log.error('ERROR');
      log.error(err);
      res.status(500);
      res.send('Error');
      return;
    }
    // results is an array consisting of messages collected during execution
    log.info(`results: ${results}`);
    sem.leave();
    res.send(JSON.stringify(results));
  });

  shell.on('stderr', (stderr) => {
    // handle stderr (a line of text from stderr)
    log.info(`[PythonShell stderr event] ${stderr}`);
  });
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
 * Run the query cmr service for a work item pulled from Harmony
  * @param operation - The requested operation
  * @param callback - Function to call with result
  */
export function runQueryCmrFromPull(workItem: WorkItem): Promise<ServiceResponse> {
  const { operation, scrollID } = workItem;
  const args = [
    'tasks/query-cmr/app/cli',
    '--harmony-input',
    `${JSON.stringify(operation)}`,
    '--scroll-id',
    scrollID,
    '--output-dir',
    `/tmp/metadata/${operation.requestId}/${workItem.id}/outputs`,
  ];

  const opts = {
    cwd: '/app',
  };

  return new Promise<ServiceResponse>((resolve) => {
    log.info(`Calling service ${env.harmonyService}`);
    const process = spawn('node', args, opts);
    process.stdout.on('data', (data) => {
      log.info(data.toString());
    });
    process.stderr.on('data', (data) => {
      log.error(data.toString());
    });
    process.on('exit', (code) => {
      if (code !== 0) {
        resolve({ error: `Process exited with code ${code}` });
      } else {
        resolve({
          batchCatalogs: _getStacCatalogs(`/tmp/metadata/${operation.requestId}/${workItem.id}/outputs`),
        });
      }
    });
    process.on('error', (error: Error) => {
      resolve({ error: error.message });
    });
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

  const catalogDir = `/tmp/metadata/${operation.requestId}/${workItem.id}/outputs`;

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
