import * as axios from 'axios';
import { Logger } from 'winston';
import { Job } from 'models/job';

import env = require('./env');

/**
 *
 * Terminate all workflows associated with a given Job
 *
 * @param job The job associated with the workflow to terminate
 * @parm logger The Logger to use
 */
export default async function terminateWorkflows(job: Job, logger: Logger): Promise<void> {
  const { requestId } = job;
  const url = `${env.argoUrl}/api/v1/workflows/argo?listOptions.labelSelector=request_id%3D${requestId}`;

  try {
    // const response = await axios.default.get(url, config);
    const response = await axios.default.get(url);
    for (const workflow of response.data?.items) {
      logger.info(`Canceling workflow ${workflow.metadata.name}`);
      try {
        const terminateUrl = `${env.argoUrl}/api/v1/workflows/argo/${workflow.metadata.name}/terminate`;
        const body = {
          name: workflow.metadata.name,
          namespace: 'argo',
        };
        await axios.default.put(terminateUrl, body);
      } catch (te) {
        logger.error(`Workflow ${workflow.metadata.name} has failed to terminate`);
        throw te;
      }
    }
  } catch (e) {
    logger.error(`Argo workflow termination failed: ${JSON.stringify(e.response?.data)}`);
    logger.error(`Argo url: ${url}`);
    throw e;
  }
}
