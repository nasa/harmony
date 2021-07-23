import request from 'superagent';
import { Worker } from '../../../../app/workers/worker';
import env from '../util/env';
import logger from '../util/log';
import { aRunServiceFromPull } from '../service/service-runner';

/**
 * Requests work items from Harmony
 */
async function pullWork(): Promise<{ error?: string }> {
  try {
    const response = await request
      .get(env.pullUrl)
      .accept('application/json')
      .timeout({
        response: 30_000, // Wait up to 30 seconds for the server to start sending
        deadline: 60_000, // but allow up to 60 seconds for the server to complete the response;
      });

    logger.info(response.text);
    return response.body;
  } catch (err) {
    logger.error(`Request failed with error: ${err.message}`);
    return { error: err.message };
  }
}

/**
 *
 */
async function pullAndDoWork(): Promise<void> {
  const work = await pullWork();
  if (!work.error) {
    aRunServiceFromPull(work).then(() => {
      // TODO call back to Harmony to mark work unit as complete

      logger.info('Finished work');
      // wait a short time before polling again
      setTimeout(pullAndDoWork, 5_000);
    });
  } else if (work.error === 'Timemout') {
    // timeouts are expected - just try again after a short delay (100 ms)
    setTimeout(pullAndDoWork, 100);
  } else {
    // something bad happened
    logger.error(`Unexpected error while pulling work: ${work.error}`);
  }
}

export default class PullWorker implements Worker {
  async start(): Promise<void> {
    // poll the Harmony work endpoint
    pullAndDoWork();
  }
}
