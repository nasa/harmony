import { InstalledClock } from '@sinonjs/fake-timers';

import { ItemRun, Pod, WorkerPool } from './actors';
import { Engine } from './engine';
import { Harness, PassRecord } from './harness';
import { activatePolicy, PolicySampler } from './policies';
import { rngFor } from './rng';
import { formatDuration, ResolvedScenario } from './scenario';
import { SubmittedJob, Workload } from './workload';
import { JobStatus, terminalStates } from '../../../services/harmony/app/models/job';
import db from '../../../services/harmony/app/util/db';
import env from '../../../services/harmony/app/util/env';
import logger from '../../../services/harmony/app/util/log';
import { WorkItemQueueType } from '../../../services/harmony/app/util/queue/queue';
import { processSchedulerQueue } from '../../../services/work-scheduler/app/workers/scheduler';
import { batchProcessQueue } from '../../../services/work-updater/app/workers/updater';

export interface DecisionRecord {
  t: number;
  service: string;
  batchSize: number;
  // [job name, items requested, items received] in the order the policy asked
  takes: [string, number, number][];
}

export interface ServiceSample {
  service: string;
  pods: number;
  busyPods: number;
  queued: number;
  // per user: work items ready in the database, running according to user_work (which includes
  // items sitting on the service queue), and pods actually running their work
  readyByUser: Record<string, number>;
  runningByUser: Record<string, number>;
  busyByUser: Record<string, number>;
  policy?: Record<string, number>;
}

export interface Sample {
  t: number;
  services: ServiceSample[];
}

export interface JobResult {
  name: string;
  user: string;
  async: boolean;
  granules: number;
  services: string[];
  submitMs: number;
  endMs: number | null;
  status: string;
}

export interface WorkItemRow {
  id: number;
  job: string;
  serviceID: string;
  stepIndex: number;
  itemIndex: number;
  status: string;
  createdMs: number;
  queuedMs: number | null;
  doneMs: number;
  durationMs: number;
  retryCount: number;
}

export interface RunResult {
  scenario: ResolvedScenario;
  policy: string;
  endMs: number;
  wallMs: number;
  eventsRun: number;
  completed: boolean;
  jobs: JobResult[];
  runs: ItemRun[];
  workItems: WorkItemRow[];
  decisions: DecisionRecord[];
  samples: Sample[];
  env: Record<string, string | number>;
}

export interface SimulationOptions {
  scenario: ResolvedScenario;
  policy: string;
  runDir: string;
  clock: InstalledClock;
  logLevel: string;
  progress: (message: string) => void;
}

/**
 * Converts a date value read back from sqlite (stored as epoch milliseconds) to virtual time.
 *
 * @param value - the stored value
 * @param epochMs - the simulation epoch
 * @returns the virtual time in milliseconds, or null
 */
function toVirtualMs(value: unknown, epochMs: number): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Number(value);
  return Number.isNaN(ms) ? null : ms - epochMs;
}

/**
 * Runs a scenario under a fair queueing policy.
 *
 * @param options - the simulation options
 * @returns the raw results of the run
 */
export async function simulate(options: SimulationOptions): Promise<RunResult> {
  const { scenario, clock } = options;
  const infra = scenario.infrastructure;
  const epochMs = clock.now;
  const engine = new Engine(clock);
  const wallStart = process.hrtime.bigint();

  const jobsByID = new Map<string, SubmittedJob>();
  const jobNames = new Map<string, string>();
  const runs: ItemRun[] = [];
  const decisions: DecisionRecord[] = [];
  const samples: Sample[] = [];
  const endTimes = new Map<string, { endMs: number; status: string }>();

  const harness = new Harness({
    runDir: options.runDir,
    logLevel: options.logLevel,
    random: rngFor(scenario.seed, 'math-random'),
    podCounts: Object.fromEntries(scenario.services.map((s) => [s.id, s.pods])),
    schedulerPods: infra.schedulerPods,
    observer: {
      onSchedulingPass(pass: PassRecord): void {
        decisions.push({
          t: engine.now(),
          service: pass.serviceID,
          batchSize: pass.batchSize,
          takes: pass.takes.map((take) => [jobNames.get(take.jobID) ?? take.jobID, take.requested, take.got]),
        });
      },
    },
  });
  await harness.install();
  const sampler: PolicySampler = activatePolicy(options.policy);

  const workload = new Workload(scenario);
  for (const job of scenario.jobs) {
    jobNames.set(workload.jobIDFor(job), job.name);
  }

  // service pods
  const pods: Pod[] = [];
  const podsByService = new Map<string, Pod[]>();
  for (const service of scenario.services) {
    const queue = harness.serviceQueue(service.id);
    const servicePods: Pod[] = [];
    for (let i = 0; i < service.pods; i++) {
      const pod = new Pod(`${service.name}-${i}`, service, queue, {
        engine,
        logger,
        seed: scenario.seed,
        longPollMs: env.queueLongPollingWaitTimeSec * 1000,
        pollIntervalMs: infra.podPollIntervalMs,
        receiveLatencyMs: infra.podReceiveLatencyMs,
        jobFor: (jobID): SubmittedJob => jobsByID.get(jobID),
        onRunStart: (run): void => { runs.push(run); },
        onRunEnd: (): void => {},
      });
      servicePods.push(pod);
      pods.push(pod);
      // spread the pods' first polls over one polling interval
      pod.start(Math.floor((i * infra.podPollIntervalMs) / service.pods));
    }
    podsByService.set(service.id, servicePods);
    // each message sent to the service queue wakes one long-polling pod
    queue.onSend(() => servicePods.find((p) => p.isWaiting())?.wake());
  }

  // work-scheduler pods
  new WorkerPool(
    'scheduler', infra.schedulerPods, harness.schedulerQueue, engine,
    infra.schedulerWakeLatencyMs, infra.schedulerPassTimeMs,
    async () => {
      await processSchedulerQueue(logger);
      return harness.takePendingSleepMs();
    },
  );

  // checks for newly finished jobs and stops the simulation when everything is done
  let submittedCount = 0;
  const checkJobs = async (): Promise<void> => {
    const finished = await db('jobs')
      .select('jobID', 'status')
      .whereIn('status', terminalStates);
    for (const row of finished) {
      if (!endTimes.has(row.jobID)) {
        endTimes.set(row.jobID, { endMs: engine.now(), status: row.status });
      }
    }
    if (submittedCount === scenario.jobs.length && endTimes.size === scenario.jobs.length) {
      engine.stop();
    }
  };

  // work-updater pods (the large item queue is only used for updates with several results,
  // which simulated services never produce, but it gets a worker for completeness)
  for (const [type, count] of [
    [WorkItemQueueType.SMALL_ITEM_UPDATE, infra.updaterPods],
    [WorkItemQueueType.LARGE_ITEM_UPDATE, 1],
  ] as [WorkItemQueueType, number][]) {
    new WorkerPool(
      `updater ${type}`, count, harness.updateQueues[type], engine,
      infra.updaterWakeLatencyMs, infra.updaterBatchTimeMs,
      async () => {
        await batchProcessQueue(type);
        await checkJobs();
        return 0;
      },
    );
  }

  // job submissions
  const submit = async (spec: ResolvedScenario['jobs'][number]): Promise<void> => {
    const submitted = await workload.submit(spec, engine.now());
    jobsByID.set(submitted.jobID, submitted);
    submittedCount += 1;
  };
  for (const spec of scenario.jobs) {
    engine.schedule(spec.submitAtMs, `submit ${spec.name}`, () => submit(spec));
  }

  // periodic samples of the system state
  const takeSample = async (): Promise<void> => {
    const rows = await db('user_work')
      .select('username', 'service_id')
      .sum({ ready: 'ready_count', running: 'running_count' })
      .groupBy('username', 'service_id');
    const services: ServiceSample[] = [];
    for (const service of scenario.services) {
      const servicePods = podsByService.get(service.id);
      const busyByUser: Record<string, number> = {};
      for (const pod of servicePods) {
        if (pod.run) busyByUser[pod.run.user] = (busyByUser[pod.run.user] || 0) + 1;
      }
      const readyByUser: Record<string, number> = {};
      const runningByUser: Record<string, number> = {};
      for (const row of rows.filter((r) => r.service_id === service.id)) {
        if (Number(row.ready) > 0) readyByUser[row.username] = Number(row.ready);
        if (Number(row.running) > 0) runningByUser[row.username] = Number(row.running);
      }
      services.push({
        service: service.name,
        pods: service.pods,
        busyPods: servicePods.filter((p) => p.run).length,
        queued: harness.serviceQueue(service.id).visibleCount(),
        readyByUser,
        runningByUser,
        busyByUser,
        policy: sampler ? await sampler(db, service.id, service.pods) : undefined,
      });
    }
    samples.push({ t: engine.now(), services });
  };
  const sampleLoop = async (): Promise<void> => {
    await takeSample();
    engine.schedule(infra.sampleIntervalMs, 'sample', sampleLoop);
  };
  engine.schedule(0, 'sample', sampleLoop);

  // progress reporting
  const progressLoop = (): void => {
    options.progress(`  t=${formatDuration(engine.now())} jobs finished ${endTimes.size}/${scenario.jobs.length}`);
    engine.schedule(3_600_000, 'progress', progressLoop);
  };
  engine.schedule(3_600_000, 'progress', progressLoop);

  const endMs = await engine.run(scenario.maxDurationMs);
  await takeSample();

  // read back the final state of every job and work item
  const workItemRows = await db('work_items')
    .select('id', 'jobID', 'serviceID', 'workflowStepIndex', 'sortIndex', 'status', 'createdAt', 'startedAt',
      'updatedAt', 'duration', 'retryCount')
    .orderBy('id');
  const workItems: WorkItemRow[] = workItemRows.map((r) => ({
    id: r.id,
    job: jobNames.get(r.jobID) ?? r.jobID,
    serviceID: r.serviceID,
    stepIndex: r.workflowStepIndex,
    itemIndex: r.sortIndex,
    status: r.status,
    createdMs: toVirtualMs(r.createdAt, epochMs),
    queuedMs: toVirtualMs(r.startedAt, epochMs),
    doneMs: toVirtualMs(r.updatedAt, epochMs),
    durationMs: Number(r.duration),
    retryCount: r.retryCount,
  }));

  const serviceIDs = Object.fromEntries(scenario.services.map((s) => [s.name, s.id]));
  const jobs: JobResult[] = scenario.jobs.map((spec) => {
    const jobID = workload.jobIDFor(spec);
    const end = endTimes.get(jobID);
    return {
      name: spec.name,
      user: spec.user,
      async: spec.async,
      granules: spec.granules,
      services: spec.steps.map((s) => serviceIDs[s.service]),
      submitMs: spec.submitAtMs,
      endMs: end?.endMs ?? null,
      status: end?.status ?? (jobsByID.has(jobID) ? JobStatus.RUNNING : 'not submitted'),
    };
  });

  const { eventsRun } = engine;
  await harness.uninstall();

  return {
    scenario,
    policy: options.policy,
    endMs,
    wallMs: Number(process.hrtime.bigint() - wallStart) / 1e6,
    eventsRun,
    completed: endTimes.size === scenario.jobs.length,
    jobs,
    runs,
    workItems,
    decisions,
    samples,
    env: {
      QUEUE_LONG_POLLING_WAIT_TIME_SEC: env.queueLongPollingWaitTimeSec,
      ...Object.fromEntries(Object.entries(scenario.env)),
    },
  };
}
