import { PythonShell } from 'python-shell';
import { Response } from 'express';
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
  PythonShell.run('-m', options, (err, results) => {
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
    '--scrollId',
    scrollID,
    '--output-dir',
    `/tmp/metadata/${operation.requestId}/outputs`,
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
        resolve({ 'batch-catalogs': '/tmp/outputs/batch-catalogs.json' });
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
export function runPythonServiceFromPull(operation: any): Promise<{}> {
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
  return new Promise<{}>((resolve) => {
    log.info(`Calling service ${env.harmonyService}`);
    PythonShell.run('-m', options, (err, results) => {
      if (err) {
        // sem.leave();
        log.error('ERROR');
        log.error(err);
        resolve({ error: err });
      }
      // results is an array consisting of messages collected during execution
      log.info(`results: ${results}`);
      // sem.leave();
      resolve({ results });
    });
  });
}

/**
 *  Run a service for a work item pulled from Harmony
 * @param operation - The requested operation
 * @param callback - Function to call with result
 */
export function runServiceFromPull(operation: any, callback: (string) => {}): void {
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
  PythonShell.run('-m', options, (err, results) => {
    if (err) {
      // sem.leave();
      log.error('ERROR');
      log.error(err);
      callback(err);
    }
    // results is an array consisting of messages collected during execution
    log.info(`results: ${results}`);
    // sem.leave();
    callback(results);
  });
}
