import { Logger } from 'winston';
import { Job } from '../models/job';
import { getArchivedWorkflowsForJob, getWorkflowsForJob, Workflow } from '../util/workflows';
import { Worker } from './worker';
import db from '../util/db';
import env from '../util/env';
import sleep from '../util/sleep';

/**
 * Returns true if the workflows are empty or contain a terminated workflow
 * @param workflows - The workflows to check
 * @returns true if the workflow array is empty or if any of its workflows have failed
 */
function isOrphan(workflows: Workflow[]): boolean {
  if (workflows.length === 0) return true;

  for (const workflow of workflows) {
    // terminated workflows have status 'Failed'
    if (workflow.status.phase === 'Failed') {
      return true;
    }
  }
  return false;
}

/**
 * Get the jobs from the given job list that have been deleted or terminated in Argo
 * @param jobs - the jobs to test for orphans
 * @param logger - the logger to use for reporting errors/info
 * @returns the jobs that are orphaned (workflow is terminated or deleted in Argo)
 */
async function getDeletedOrTerminatedJobs(jobs: Job[], logger: Logger): Promise<Job[]> {
  const result: Job[] = [];
  for (const job of jobs) {
    const workflows = await getWorkflowsForJob(job, logger);
    const archivedWorkflows = await getArchivedWorkflowsForJob(job, logger);
    if (isOrphan(workflows.concat(archivedWorkflows))) {
      result.push(job);
    }
  }
  return result;
}

export interface JobReaperConfig {

  logger: Logger;

}

export default class WorkflowReaper implements Worker {
  isRunning: boolean;

  logger: Logger;

  constructor(config: JobReaperConfig) {
    this.logger = config.logger;
  }

  async cancelOrphanedJobs(): Promise<void> {
    const oldRunningJobs: Job[] = [];
    let isDone = false;
    let page = 0;
    try {
      while (!isDone) {
        const result = await Job.notUpdatedForMinutes(db, env.reapableJobAgeMinutes, page);
        if (result.data.length > 0) {
          oldRunningJobs.push(...result.data);
        } else {
          isDone = true;
        }
        page += 1;
      }

      // return any of the old jobs that have workflows that are terminated or deleted
      const orphans = await getDeletedOrTerminatedJobs(oldRunningJobs, this.logger);

      // cancel the orphaned jobs
      for (const job of orphans) {
        this.logger.info(`Reaping job ${job.requestId}`);
        job.cancel('Canceled by job reaper');
        try {
          await job.save(db);
        } catch (e) {
          this.logger.error(`Failed to cancel job ${job.requestId}`);
          throw (e);
        }
      }
    } catch (e) {
      this.logger.error('Error while trying to cancel orphaned jobs');
      this.logger.error(e);
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    let firstRun = true;
    while (this.isRunning) {
      if (!firstRun) {
        await sleep(env.jobReaperPeriodSec * 1000);
      }
      this.logger.info('Starting job reaper');
      try {
        await this.cancelOrphanedJobs();
      } catch (e) {
        this.logger.error('Job reaper failed to cancel jobs');
        this.logger.error(e);
      } finally {
        firstRun = false;
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }
}
