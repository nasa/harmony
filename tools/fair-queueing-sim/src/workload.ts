import * as fs from 'fs';
import * as path from 'path';

import { REPO_ROOT } from './bootstrap';
import { rngFor, uuidFrom } from './rng';
import { ResolvedJob, ResolvedScenario } from './scenario';
import { makeWorkScheduleRequest } from '../../../services/harmony/app/backends/workflow-orchestration/work-item-polling';
import DataOperation, { CURRENT_SCHEMA_VERSION } from '../../../services/harmony/app/models/data-operation';
import { Job, JobStatus } from '../../../services/harmony/app/models/job';
import UserWork from '../../../services/harmony/app/models/user-work';
import WorkItem from '../../../services/harmony/app/models/work-item';
import { WorkItemStatus } from '../../../services/harmony/app/models/work-item-interface';
import WorkflowStep from '../../../services/harmony/app/models/workflow-steps';
import db from '../../../services/harmony/app/util/db';

const SAMPLE_OPERATION = path.join(
  REPO_ROOT, 'services', 'harmony', 'test', 'resources', 'data-operation-samples', 'valid-operation-input.json',
);

export interface SubmittedJob {
  spec: ResolvedJob;
  jobID: string;
  // the Harmony service ID for each step, in order
  serviceIDs: string[];
  submittedAtMs: number;
}

/**
 * Creates jobs in the database. Mirrors what BaseService._createAndSaveWorkflow does for a real
 * request, except that the first step is the scenario's first service rather than query-cmr, and
 * all of the first step's work items (one per granule) are created up front.
 */
export class Workload {
  private readonly operationTemplate: object;

  private readonly serviceIDs: Record<string, string>;

  /**
   * Creates the workload.
   *
   * @param scenario - the resolved scenario
   */
  constructor(private readonly scenario: ResolvedScenario) {
    this.operationTemplate = JSON.parse(fs.readFileSync(SAMPLE_OPERATION, 'utf8'));
    this.serviceIDs = Object.fromEntries(scenario.services.map((s) => [s.name, s.id]));
  }

  /**
   * Returns the deterministic job ID for a job.
   *
   * @param spec - the job
   * @returns the job ID
   */
  jobIDFor(spec: ResolvedJob): string {
    return uuidFrom(rngFor(this.scenario.seed, 'job-id', spec.name));
  }

  /**
   * Creates the job, its workflow steps, user_work rows and first step work items, then asks the
   * scheduler to schedule work for the first service.
   *
   * @param spec - the job to submit
   * @param nowMs - the current virtual time
   * @returns the submitted job
   */
  async submit(spec: ResolvedJob, nowMs: number): Promise<SubmittedJob> {
    const jobID = this.jobIDFor(spec);
    const serviceIDs = spec.steps.map((step) => this.serviceIDs[step.service]);
    const operation = new DataOperation({
      ...structuredClone(this.operationTemplate),
      requestId: jobID,
      user: spec.user,
      isSynchronous: !spec.async,
    });
    const serializedOperation = operation.serialize(CURRENT_SCHEMA_VERSION);

    await db.transaction(async (tx) => {
      const job = new Job({
        jobID,
        requestId: jobID,
        username: spec.user,
        status: JobStatus.RUNNING,
        message: 'simulated job',
        progress: 0,
        batchesCompleted: 0,
        links: [],
        request: `http://fair-queueing-sim.example.com/${this.scenario.name}/${spec.name}`,
        numInputGranules: spec.granules,
        isAsync: spec.async,
        ignoreErrors: spec.ignoreErrors,
        collectionIds: [],
      });
      await job.save(tx);

      for (const [i, serviceID] of serviceIDs.entries()) {
        await new WorkflowStep({
          jobID,
          serviceID,
          stepIndex: i + 1,
          workItemCount: i === 0 ? spec.granules : 0,
          operation: serializedOperation,
          hasAggregatedOutput: false,
          isBatched: false,
          is_sequential: false,
          always_wait_for_prior_step: false,
          progress_weight: 1.0,
        }).save(tx);

        await new UserWork({
          job_id: jobID,
          service_id: serviceID,
          username: spec.user,
          ready_count: i === 0 ? spec.granules : 0,
          running_count: 0,
          is_async: spec.async,
          last_worked: new Date(),
        }).save(tx);
      }

      const workItems = Array.from({ length: spec.granules }, (_unused, k) => new WorkItem({
        jobID,
        serviceID: serviceIDs[0],
        status: WorkItemStatus.READY,
        workflowStepIndex: 1,
        sortIndex: k,
        stacCatalogLocation: `s3://sim/${spec.name}/inputs/${k}/catalog.json`,
      }));
      for (let i = 0; i < workItems.length; i += 500) {
        await WorkItem.insertBatch(tx, workItems.slice(i, i + 500));
      }
    });

    await makeWorkScheduleRequest(serviceIDs[0]);
    return { spec, jobID, serviceIDs, submittedAtMs: nowMs };
  }
}
