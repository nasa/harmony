import { PythonShell } from 'python-shell';
import { Response } from 'express';
import env from '../util/env'
import log from '../util/log';
import sem from '../util/semaphore'

export function runService(operation: any, res: Response) {
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
    ]
  };

  log.info(`Calling service ${env.harmonyService}`);
  PythonShell.run('-m', options, function (err, results) {
    if (err) {
      sem.leave();
      log.error("ERROR");
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