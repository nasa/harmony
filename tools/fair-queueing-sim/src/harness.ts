import * as fs from 'fs';
import * as path from 'path';

import * as sinon from 'sinon';

import { REPO_ROOT } from './bootstrap';
import type { PolicyEntry } from './policies';
import { Random } from './rng';
import { SimQueue } from './sim-queue';
import * as workItemPolling from '../../../services/harmony/app/backends/workflow-orchestration/work-item-polling';
import * as workItemModel from '../../../services/harmony/app/models/work-item';
import { COMPLETED_WORK_ITEM_STATUSES } from '../../../services/harmony/app/models/work-item-interface';
import * as aggregationBatch from '../../../services/harmony/app/util/aggregation-batch';
import db from '../../../services/harmony/app/util/db';
import logger, { configureLogToFile } from '../../../services/harmony/app/util/log';
import { WorkItemQueueType } from '../../../services/harmony/app/util/queue/queue';
import * as queueFactory from '../../../services/harmony/app/util/queue/queue-factory';
import * as sleepModule from '../../../services/harmony/app/util/sleep';
import * as stac from '../../../services/harmony/app/util/stac';
import * as k8s from '../../../services/work-scheduler/app/util/k8s';

//
// The harness replaces the pieces of Harmony that talk to the outside world (SQS, S3, the k8s
// API) with simulated ones, and taps a few internal calls so the simulation can record what the
// scheduler decided. Everything else - the scheduler, fair queueing, user_work bookkeeping, and
// work item update processing - is the real code running against a real (sqlite) database.
//

export interface TakeRecord {
  jobID: string;
  requested: number;
  got: number;
}

export interface PassRecord {
  serviceID: string;
  batchSize: number;
  takes: TakeRecord[];
}

export interface HarnessObserver {
  // called after each call the scheduler makes to getWorkItemsFromDatabase
  onSchedulingPass(pass: PassRecord): void;
}

export interface HarnessOptions {
  runDir: string;
  logLevel: string;
  random: Random;
  podCounts: Record<string, number>;
  schedulerPods: number;
  observer: HarnessObserver;
  // the duration a simulated pod reported for a work item's latest attempt, for policies'
  // completion hooks
  serviceDurationOf: (workItemID: number) => number | undefined;
}

export class Harness {
  readonly schedulerQueue = new SimQueue('scheduler');

  readonly updateQueues: Record<string, SimQueue> = {
    [WorkItemQueueType.SMALL_ITEM_UPDATE]: new SimQueue('small-update'),
    [WorkItemQueueType.LARGE_ITEM_UPDATE]: new SimQueue('large-update'),
  };

  private readonly serviceQueues: Record<string, SimQueue> = {};

  // total virtual ms the scheduler asked to sleep (it does this when the update queue backs up)
  private pendingSleepMs = 0;

  // the fair queueing policy to use instead of the one the work-scheduler picks, if any
  private policy: PolicyEntry | undefined;

  private readonly sandbox = sinon.createSandbox();

  private readonly realMathRandom = Math.random;

  /**
   * Creates the harness. Call install() to activate it.
   *
   * @param options - the harness options
   */
  constructor(private readonly options: HarnessOptions) {}

  /**
   * Returns the simulated queue for a service, creating it if needed.
   *
   * @param serviceID - the service ID
   * @returns the queue
   */
  serviceQueue(serviceID: string): SimQueue {
    if (!this.serviceQueues[serviceID]) {
      this.serviceQueues[serviceID] = new SimQueue(serviceID);
    }
    return this.serviceQueues[serviceID];
  }

  /**
   * Makes every scheduling pass use the given fair queueing policy instead of the one the
   * work-scheduler picks from ENABLE_DURATION_BASED_FAIR_QUEUEING, and runs the policy's setup
   * if it has one. The work-scheduler's scheduling context (pod count and fast lane settings)
   * is passed to the policy unchanged, and the policy's completion hook, if it has one, is called
   * as work items complete.
   *
   * @param entry - the policy, or undefined to leave the work-scheduler's choice alone
   */
  async usePolicy(entry: PolicyEntry | undefined): Promise<void> {
    this.policy = entry;
    if (entry?.setup) await db.transaction((tx) => entry.setup(tx));
  }

  /**
   * Returns (and resets) the virtual time the scheduler asked to sleep since the last call.
   *
   * @returns the sleep time in milliseconds
   */
  takePendingSleepMs(): number {
    const ms = this.pendingSleepMs;
    this.pendingSleepMs = 0;
    return ms;
  }

  /**
   * Creates the database schema, configures logging and installs all of the stubs.
   */
  async install(): Promise<void> {
    const { options, sandbox } = this;

    configureLogToFile(path.join(options.runDir, 'harmony.log'), true);
    logger.level = options.logLevel;

    await this.createSchema();

    // Harmony's only randomness on the scheduling path is the job shuffle in the fair queueing
    // policies (fair-queueing-policy.ts) - seed it so runs are reproducible
    Math.random = options.random;

    // SQS
    sandbox.stub(queueFactory, 'getQueueUrlForService').callsFake((serviceID: string) => `sim://${serviceID}`);
    sandbox.stub(queueFactory, 'getQueueForUrl').callsFake((url: string) => this.serviceQueue(url.replace(/^sim:\/\//, '')));
    sandbox.stub(queueFactory, 'getWorkSchedulerQueue').callsFake(() => this.schedulerQueue);
    sandbox.stub(queueFactory, 'getQueueForType').callsFake((type: WorkItemQueueType) => this.updateQueues[type]);

    // k8s pod counts used by the scheduler to size its batches
    sandbox.stub(k8s, 'getPodsCountForService').callsFake(async (serviceID: string) => options.podCounts[serviceID] ?? 0);
    sandbox.stub(k8s, 'getPodsCountForPodName').callsFake(async () => options.schedulerPods);

    // The scheduler sleeps (for real) when the update queue is too long - turn that into virtual
    // time for the scheduler actor to account for
    sandbox.stub(sleepModule, 'default').callsFake(async (ms: number) => {
      this.pendingSleepMs += ms;
    });

    // S3: simulated services don't write STAC catalogs, so the work item update path gets no
    // catalog items or output sizes (no job links are created, which doesn't affect scheduling)
    sandbox.stub(stac, 'readCatalogsItems').callsFake(async () => []);
    sandbox.stub(aggregationBatch, 'resultItemSizes').callsFake(async () => []);

    this.tapSchedulingDecisions();
  }

  /**
   * Restores everything the harness replaced.
   */
  async uninstall(): Promise<void> {
    this.sandbox.restore();
    Math.random = this.realMathRandom;
    await db.destroy();
  }

  /**
   * Records each scheduling pass: which jobs the policy asked for work items from, how many it
   * asked for and how many it got. This is the "decision log" used to compare runs.
   */
  private tapSchedulingDecisions(): void {
    const { sandbox, options } = this;
    let current: PassRecord = null;

    const realGetNextWorkItems = workItemModel.getNextWorkItems;
    sandbox.stub(workItemModel, 'getNextWorkItems').callsFake(async (tx, serviceID, jobID, workSize) => {
      const items = await realGetNextWorkItems(tx, serviceID, jobID, workSize);
      current?.takes.push({ jobID, requested: workSize, got: items?.length ?? 0 });
      return items;
    });

    const realGetWorkItemsFromDatabase = workItemPolling.getWorkItemsFromDatabase;
    sandbox.stub(workItemPolling, 'getWorkItemsFromDatabase').callsFake(async (serviceID, reqLogger, batchSize, ...rest) => {
      current = { serviceID, batchSize, takes: [] };
      // the remaining arguments are the work-scheduler's policy and scheduling context; any
      // others are passed through untouched so native runs work against other versions of Harmony
      const [policy, ...others] = rest;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (realGetWorkItemsFromDatabase as any)(serviceID, reqLogger, batchSize, this.policy?.policy ?? policy, ...others);
      options.observer.onSchedulingPass(current);
      current = null;
      return result;
    });

    // processWorkItem calls updateWorkItemStatus (in the update transaction) once a work item is
    // done - after its retries are used up, if it failed - so that's where the policy hears of it
    const realUpdateWorkItemStatus = workItemModel.updateWorkItemStatus;
    sandbox.stub(workItemModel, 'updateWorkItemStatus').callsFake(async (tx, id, status, messageCategory, duration, ...rest) => {
      await realUpdateWorkItemStatus(tx, id, status, messageCategory, duration, ...rest);
      const hook = this.policy?.onWorkItemCompleted;
      if (!hook || !COMPLETED_WORK_ITEM_STATUSES.includes(status)) return;
      const row = await tx(workItemModel.default.table).select('jobID', 'serviceID').where({ id }).first();
      await hook(tx, {
        jobID: row.jobID, serviceID: row.serviceID, workItemID: id, status, durationMs: duration,
        serviceDurationMs: options.serviceDurationOf(id),
      });
    });
  }

  /**
   * Creates a fresh database from db/db.sql, the same way bin/create-database does for tests.
   */
  private async createSchema(): Promise<void> {
    const sql = fs.readFileSync(path.join(REPO_ROOT, 'db', 'db.sql'), 'utf8');
    const conn = await db.client.acquireConnection();
    try {
      await new Promise<void>((resolve, reject) => {
        conn.exec(sql, (err: Error) => (err ? reject(err) : resolve()));
      });
    } finally {
      await db.client.releaseConnection(conn);
    }
  }
}
