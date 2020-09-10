import * as axios from 'axios';
import { Logger } from 'winston';
import { Job } from 'models/job';

import env = require('./env');

/**
 * Partial representation of a workflow as returned by Argo API
 */
export interface Workflow {
  metadata: {
    name: string;
  };
}

interface WorkflowFunction {
  (wf: Workflow, logger: Logger): Promise<void>;
}

/**
 *
 * Retrieve the list of workflows for the given Job
 *
 * @param job The job associated with the workflows
 * @param logger The Logger to use for error messages
 */
export async function getWorkflowsForJob(job: Job, logger: Logger): Promise<Workflow[]> {
  const { requestId } = job;
  const url = `${env.argoUrl}/api/v1/workflows/argo?listOptions.labelSelector=request_id%3D${requestId}`;
  try {
    const response = await axios.default.get(url);
    return response.data?.items || [];
  } catch (e) {
    logger.error(`Failed to retrieve workflows: ${JSON.stringify(e.response?.data)}`);
    throw e;
  }
}

/**
 *
 * Run the given process on the workflows associated with the given job
 *
 * @param job The job associated with the workflows to process
 * @param logger The logger to use for logging errors/info
 * @param process The process to run on each workflow associated with the job
 */
async function processWorkflows(job: Job, logger: Logger, proc: WorkflowFunction): Promise<void> {
  const workflows = await getWorkflowsForJob(job, logger);
  for (const workflow of workflows) {
    await proc(workflow, logger);
  }
}

/**
 *
 * Terminate all workflows associated with a given Job
 *
 * @param job The job associated with the workflow to terminate
 * @parm logger The Logger to use for logging errors/info
 */
export async function terminateWorkflows(job: Job, logger: Logger): Promise<void> {
  try {
    await processWorkflows(job, logger, async (workflow, lgr): Promise<void> => {
      lgr.info(`Canceling workflow ${workflow.metadata.name}`);
      try {
        const terminateUrl = `${env.argoUrl}/api/v1/workflows/argo/${workflow.metadata.name}/terminate`;
        const body = {
          name: workflow.metadata.name,
          namespace: 'argo',
        };
        await axios.default.put(terminateUrl, body);
      } catch (te) {
        lgr.error(`Workflow ${workflow.metadata.name} has failed to terminate`);
        throw te;
      }
    });
  } catch (e) {
    logger.error(`Argo workflow termination failed: ${JSON.stringify(e.response?.data)}`);
    throw e;
  }
}
