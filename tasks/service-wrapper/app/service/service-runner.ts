import * as k8s from '@kubernetes/client-node';
import { PythonShell } from 'python-shell';
import { Response } from 'express';
import { existsSync, readdirSync } from 'fs';
import { spawn } from 'child_process';
import stream from 'stream';
import env from '../util/env';
import log from '../util/log';
import sem from '../util/semaphore';
import sleep from '../../../../app/util/sleep';
import WorkItem from '../../../../app/models/work-item';

export interface ServiceResponse {
  batchCatalogs?: string[];
  error?: string;
}

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

// async function _checkForFile(path: string): Promise<boolean> {
//   fs.access(path, fs.F_OK, (err) => {
//     if (err) {
//       setTimeout()
//     }

//     // file exists
//   });
// }

// async function _waitForFile(path: string, timeout: number): Promise<void> {

// }

/**
 * Run a service for a work item pulled from Harmony
 * @param operation - The requested operation
 * @param callback - Function to call with result
 */
export async function runPythonServiceFromPull(workItem: WorkItem): Promise<{}> {
  const { operation, stacCatalogLocation } = workItem;
  const commandLine = env.invocationArgs.split('\n');
  log.debug(`Working dir: ${env.workingDir}`);

  const catalogDir = `/tmp/metadata/${operation.requestId}/${workItem.id}/outputs`;

  const kc = new k8s.KubeConfig();
  // if (this.cluster) {
  //   kc.loadFromOptions({
  //     clusters: [this.cluster],
  //     contexts: [this.context],
  //     currentContext: this.context.name,
  //   });
  // } else {
  kc.loadFromDefault();
  // }
  const exec = new k8s.Exec(kc);
  // const ex = promisify(exec.exec.bind(exec));
  log.debug('CALLING WORKER');
  // const result = await ex(
  try {
    await exec.exec(
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
      },
    );

    // log.debug(JSON.stringify(result));

    // TODO figure out error handlin
    // log.debug('Sleeping for 10 seconds');
    // await sleep(10000);
    let tryCount = 0;
    log.debug(`Testing for ${catalogDir}/catalog.json`);
    while (tryCount < 100 && !existsSync(`${catalogDir}/catalog.json`)) {
      await sleep(250); // 1/4 second
      tryCount += 1;
    }
    log.debug('Getting STAC catalogs');
    const catalogs = _getStacCatalogs(`${catalogDir}`);

    return { batchCatalogs: catalogs };
  } catch (e) {
    log.error(e.message);
    return { error: e.message };
  }

  // log.debug(`EXEC RESULT: ${JSON.stringify(execResult)}`);

  // const options = {
  //   cwd: env.workingDir,
  //   args: [
  //     ...commandLine,
  //     '--harmony-action',
  //     'invoke',
  //     '--harmony-input',
  //     `${JSON.stringify(operation)}`,
  //     '--harmony-sources',
  //     stacCatalogLocation,
  //     '--harmony-metadata-dir',
  //     `/tmp/metadata/${operation.requestId}/${workItem.id}/outputs`,
  //   ],
  // };
  // return new Promise<{}>((resolve) => {
  //   log.debug(`Calling service ${env.harmonyService}`);
  //   const shell = PythonShell.run('-u', options, (err, results) => {
  //     if (err) {
  //       log.error('ERROR');
  //       log.error(err);
  //       resolve({ error: err });
  //     } else {
  //       // results is an array consisting of messages collected during execution
  //       log.debug(`results: ${results}`);
  //       const catalogs = _getStacCatalogs(`/tmp/metadata/${operation.requestId}/${workItem.id}/outputs`);
  //       log.debug(`catalogs: ${catalogs}`);
  //       resolve({
  //         batchCatalogs: catalogs,
  //       });
  //     }
  //   });

  //   shell.on('stderr', (stderr) => {
  //     // handle stderr (a line of text from stderr)
  //     log.debug(`[PythonShell stderr event] ${stderr}`);
  //   });
  // });
}
