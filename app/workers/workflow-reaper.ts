import * as k8s from '@kubernetes/client-node';
import { Job } from 'models/job';
import { Logger } from 'winston';
import { Worker } from './worker';

export default abstract class WorkflowReaper implements Worker {
  isRunning: boolean;

  async findOrphanedJobs(): Promise<Job[]> {

  }

  async start(): Promise<void> {
    this.isRunning = true;
    while (this.isRunning) {

    }
  }

  async stop(): Promise<void> {
  }
}
