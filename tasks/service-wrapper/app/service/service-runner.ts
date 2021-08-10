import { PythonShell } from 'python-shell';
import { Response } from 'express';
import { readdir, readdirSync } from 'fs';
import { spawn } from 'child_process';
import env from '../util/env';
import log from '../util/log';
import sem from '../util/semaphore';
import WorkItem from '../../../../app/models/work-item';

export interface ServiceResponse {
  batchCatalogs?: string[];
  error?: string;
}

/**
 *
 * @param operation - The requested operation
 * @param res - The Response to use to reply
 */
export function runServiceForRequest(operation: any, res: Response): void {
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

  shell.on('stderr', function (stderr) {
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
    .filter((fileName) => fileName.match(/catalog\d+.json/))
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

  return new Promise<{}>((resolve) => {
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
export function runPythonServiceFromPull(workItem: WorkItem): Promise<{}> {
  const { operation, stacCatalogLocation } = workItem;
  const commandLine = env.invocationArgs.split('\n');
  const options = {
    // pythonOptions: ['-u'], // get print results in real-time
    cwd: '/home',
    args: [
      ...commandLine,
      '--harmony-action',
      'invoke',
      '--harmony-input',
      `${JSON.stringify(operation)}`,
      '--harmony-sources',
      stacCatalogLocation,
      '--harmony-metadata-dir',
      `/tmp/metadata/${operation.requestId}/${workItem.id}/outputs`,
    ],
  };
  return new Promise<{}>((resolve) => {
    log.info(`Calling service ${env.harmonyService}`);
    const shell = PythonShell.run('-u', options, (err, results) => {
      if (err) {
        log.error('ERROR');
        log.error(err);
        resolve({ error: err });
      } else {
        // results is an array consisting of messages collected during execution
        log.debug(`results: ${results}`);
        resolve({
          batchCatalogs: _getStacCatalogs(`/tmp/metadata/${operation.requestId}/${workItem.id}/outputs`),
        });
      }
    });

    shell.on('stderr', function (stderr) {
      // handle stderr (a line of text from stderr)
      log.info(`[PythonShell stderr event] ${stderr}`);
    });
  });
}
