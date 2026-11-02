import { EventHandle, Engine } from './engine';
import { rngFor } from './rng';
import { durationSpecForItem, ResolvedService, sampleDuration } from './scenario';
import { SimQueue } from './sim-queue';
import { SubmittedJob } from './workload';
import { getWorkFromQueue } from '../../../services/harmony/app/backends/workflow-orchestration/work-item-polling';
import { queueWorkItemUpdate } from '../../../services/harmony/app/backends/workflow-orchestration/workflow-orchestration';
import WorkItem from '../../../services/harmony/app/models/work-item';
import { WorkItemStatus } from '../../../services/harmony/app/models/work-item-interface';
import WorkItemUpdate from '../../../services/harmony/app/models/work-item-update';
import type harmonyLogger from '../../../services/harmony/app/util/log';
import { WorkItemQueueType } from '../../../services/harmony/app/util/queue/queue';

type Logger = typeof harmonyLogger;

export interface ItemRun {
  workItemID: number;
  jobName: string;
  user: string;
  serviceID: string;
  stepIndex: number;
  itemIndex: number;
  attempt: number;
  pod: string;
  startMs: number;
  endMs?: number;
  status?: WorkItemStatus;
}

export interface PodContext {
  engine: Engine;
  logger: Logger;
  seed: number;
  longPollMs: number;
  pollIntervalMs: number;
  receiveLatencyMs: number;
  jobFor(jobID: string): SubmittedJob;
  onRunStart(run: ItemRun): void;
  onRunEnd(run: ItemRun): void;
}

/**
 * A simulated service pod. It behaves like service-runner's pull worker talking to Harmony's
 * /service/work endpoint: ask for work (getWorkFromQueue, which also asks the scheduler for more
 * when the queue is empty), long poll the service queue if there is none, "run" the work item for
 * a duration drawn from the scenario, then report the result through the work item update queue
 * exactly as Harmony's PUT /service/work/:id handler does.
 */
export class Pod {
  run: ItemRun = null;

  private waitHandle: EventHandle = null;

  /**
   * Creates a pod.
   *
   * @param name - the pod name
   * @param service - the service the pod runs
   * @param queue - the service's work item queue
   * @param ctx - shared simulation context
   */
  constructor(
    readonly name: string,
    readonly service: ResolvedService,
    private readonly queue: SimQueue,
    private readonly ctx: PodContext,
  ) {}

  /**
   * Starts the pod's polling loop after the given delay.
   *
   * @param delayMs - the delay before the first poll
   */
  start(delayMs: number): void {
    this.ctx.engine.schedule(delayMs, `poll ${this.name}`, () => this.poll());
  }

  /**
   * True if the pod is waiting on a long poll of its service queue.
   *
   * @returns true if waiting
   */
  isWaiting(): boolean {
    return this.waitHandle !== null;
  }

  /**
   * Called when a message arrives on the queue this pod is long polling.
   */
  wake(): void {
    if (!this.waitHandle) return;
    this.waitHandle.cancel();
    this.waitHandle = null;
    this.ctx.engine.schedule(this.ctx.receiveLatencyMs, `poll ${this.name}`, () => this.poll());
  }

  private async poll(): Promise<void> {
    const { ctx } = this;
    const data = await getWorkFromQueue(this.service.id, ctx.logger);
    if (data?.workItem) {
      this.begin(data.workItem);
      return;
    }
    // nothing on the queue - long poll until a message arrives or the poll times out, then wait
    // for service-runner's polling interval before asking again
    this.waitHandle = ctx.engine.schedule(ctx.longPollMs, `long poll timeout ${this.name}`, () => {
      this.waitHandle = null;
      ctx.engine.schedule(ctx.pollIntervalMs, `poll ${this.name}`, () => this.poll());
    });
  }

  private begin(workItem: WorkItem): void {
    const { ctx } = this;
    const job = ctx.jobFor(workItem.jobID);
    const step = job.spec.steps[workItem.workflowStepIndex - 1];
    const itemIndex = workItem.sortIndex;
    const attempt = workItem.retryCount ?? 0;
    const random = rngFor(ctx.seed, 'work-item', job.spec.name, workItem.workflowStepIndex, itemIndex, attempt);
    const durationMs = sampleDuration(durationSpecForItem(step, itemIndex), random);
    const fails = (step.failureRate ?? 0) > 0 && random() < step.failureRate;

    this.run = {
      workItemID: workItem.id,
      jobName: job.spec.name,
      user: job.spec.user,
      serviceID: this.service.id,
      stepIndex: workItem.workflowStepIndex,
      itemIndex,
      attempt,
      pod: this.name,
      startMs: ctx.engine.now(),
    };
    ctx.onRunStart(this.run);
    ctx.engine.schedule(durationMs, `finish ${this.name}`, () => this.finish(workItem, durationMs, fails));
  }

  private async finish(workItem: WorkItem, durationMs: number, fails: boolean): Promise<void> {
    const { ctx } = this;
    const status = fails ? WorkItemStatus.FAILED : WorkItemStatus.SUCCESSFUL;
    const results = fails ? undefined : [
      `s3://sim/${this.run.jobName}/step-${workItem.workflowStepIndex}/${workItem.sortIndex}/catalog.json`,
    ];
    const update: WorkItemUpdate = {
      workItemID: workItem.id,
      status,
      results,
      workflowStepIndex: workItem.workflowStepIndex,
      message: fails ? 'Simulated work item failure' : undefined,
      totalItemsSize: 0,
      duration: durationMs,
    };
    // as in Harmony's updateWorkItem handler
    const operation = workItem.operation as unknown as { sources?: { variables: unknown[] }[] };
    for (const source of operation?.sources || []) {
      source.variables = [];
    }
    const queueType = results?.length > 1 ? WorkItemQueueType.LARGE_ITEM_UPDATE : WorkItemQueueType.SMALL_ITEM_UPDATE;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await queueWorkItemUpdate(workItem.jobID, update, operation as any, queueType, ctx.logger);

    this.run.endMs = ctx.engine.now();
    this.run.status = status;
    ctx.onRunEnd(this.run);
    this.run = null;
    ctx.engine.schedule(ctx.pollIntervalMs, `poll ${this.name}`, () => this.poll());
  }
}

/**
 * A pool of workers (work-scheduler or work-updater pods) that each process their queue in a
 * loop. A worker wakes up shortly after a message arrives, does one pass of the real Harmony code
 * (which takes no virtual time), then stays busy for a configured "pass time" (plus any time the
 * pass asked to sleep) before checking the queue again.
 */
export class WorkerPool {
  private readonly busy: boolean[];

  private readonly scheduled: boolean[];

  passes = 0;

  /**
   * Creates the pool.
   *
   * @param name - a name for the pool
   * @param size - the number of workers
   * @param queue - the queue the workers process
   * @param engine - the simulation engine
   * @param wakeLatencyMs - delay between a message arriving and an idle worker starting a pass
   * @param passTimeMs - virtual time taken by each pass
   * @param doPass - runs one pass and returns any extra virtual time it took
   */
  constructor(
    private readonly name: string,
    size: number,
    private readonly queue: SimQueue,
    private readonly engine: Engine,
    private readonly wakeLatencyMs: number,
    private readonly passTimeMs: number,
    private readonly doPass: () => Promise<number>,
  ) {
    this.busy = new Array(size).fill(false);
    this.scheduled = new Array(size).fill(false);
    queue.onSend(() => this.notify());
  }

  /**
   * Wakes an idle worker, if there is one, to process the queue.
   */
  notify(): void {
    if (this.scheduled.some((s) => s)) return;
    const i = this.busy.findIndex((b) => !b);
    if (i < 0) return;
    this.scheduled[i] = true;
    this.engine.schedule(this.wakeLatencyMs, `${this.name} ${i}`, () => this.pass(i));
  }

  private async pass(i: number): Promise<void> {
    this.scheduled[i] = false;
    if (this.queue.visibleCount() === 0) return;
    this.busy[i] = true;
    this.passes += 1;
    const extraMs = await this.doPass();
    this.engine.schedule(this.passTimeMs + extraMs, `${this.name} ${i} done`, () => {
      this.busy[i] = false;
      if (this.queue.visibleCount() > 0) this.notify();
    });
    // other idle workers can pick up whatever arrives while this one is busy
    if (this.queue.visibleCount() > 0) this.notify();
  }
}
