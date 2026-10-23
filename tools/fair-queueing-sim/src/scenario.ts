import * as fs from 'fs';

import * as yaml from 'js-yaml';

import { Random, rngFor, standardNormal } from './rng';

//
// Scenario files describe the simulated cluster (services and their pod counts, plus the
// latencies of the Harmony components around the scheduler) and the workload (jobs submitted by
// users, each a chain of service steps with a work item duration distribution per step).
//
// Durations may be given as a number of milliseconds or as a string with a unit, e.g. "250ms",
// "30s", "10m", "2h" or "1d".
//

export type Duration = number | string;

export type DurationSpec =
  | Duration
  | { dist: 'fixed'; value: Duration }
  | { dist: 'uniform'; min: Duration; max: Duration }
  | { dist: 'exponential'; mean: Duration }
  | { dist: 'lognormal'; median: Duration; sigma: number }
  | { dist: 'mix'; options: { weight: number; duration: DurationSpec }[] };

export interface StepSpec {
  // name of the service (from the scenario's services list) that performs this step
  service: string;
  // how long each work item takes to run on a pod
  duration: DurationSpec;
  // optional changes in duration part way through the job, by work item index, e.g. to model a
  // job whose granules suddenly get much slower
  phases?: { fromItem: number; duration: DurationSpec }[];
  // probability that any single attempt of a work item fails (it is then retried by Harmony)
  failureRate?: number;
}

export interface JobTemplate {
  async?: boolean;
  // number of input granules, which is the number of work items for each step
  granules: number | { min: number; max: number };
  ignoreErrors?: boolean;
  steps: StepSpec[];
}

export interface JobSpec extends JobTemplate {
  name: string;
  user: string;
  submitAt?: Duration;
}

export interface GeneratorSpec {
  // prefix for the generated job names, which are `${name}-1`, `${name}-2`, ...
  name: string;
  user: string;
  // time of the first submission (defaults to 0)
  start?: Duration;
  // time between submissions
  every: DurationSpec;
  // stop after this many jobs or at this time, whichever comes first
  count?: number;
  until?: Duration;
  job: JobTemplate;
}

export interface ServiceSpec {
  name: string;
  // the Harmony service ID (docker image) - defaults to harmonyservices/sim-<name>:latest
  id?: string;
  pods: number;
}

export interface InfrastructureSpec {
  // number of work-scheduler pods (used by the scheduler when sizing batches)
  schedulerPods?: number;
  // number of work-updater pods processing the small work item update queue
  updaterPods?: number;
  // delay before an idle scheduler / updater notices a new message on its queue
  schedulerWakeLatency?: Duration;
  updaterWakeLatency?: Duration;
  // virtual time taken by one scheduler pass / one updater batch
  schedulerPassTime?: Duration;
  updaterBatchTime?: Duration;
  // delay between a message arriving on a service queue and a long-polling pod receiving it
  podReceiveLatency?: Duration;
  // delay between a pod finishing (or failing to get) work and asking for more
  // (service-runner's polling interval)
  podPollInterval?: Duration;
  // how often to sample the state of the system for the timeline and fairness metrics
  sampleInterval?: Duration;
}

export interface Scenario {
  name: string;
  description?: string;
  seed?: number;
  // stop the simulation at this virtual time even if jobs are still running
  maxDuration?: Duration;
  // fair queueing policy to use, unless overridden on the command line
  policy?: string;
  // environment variables for Harmony, the work-scheduler, the work-updater and the policies
  env?: Record<string, string | number | boolean>;
  infrastructure?: InfrastructureSpec;
  services: ServiceSpec[];
  jobs?: JobSpec[];
  generators?: GeneratorSpec[];
}

export interface ResolvedInfrastructure {
  schedulerPods: number;
  updaterPods: number;
  schedulerWakeLatencyMs: number;
  updaterWakeLatencyMs: number;
  schedulerPassTimeMs: number;
  updaterBatchTimeMs: number;
  podReceiveLatencyMs: number;
  podPollIntervalMs: number;
  sampleIntervalMs: number;
}

export interface ResolvedService {
  name: string;
  id: string;
  pods: number;
}

export interface ResolvedJob {
  name: string;
  user: string;
  submitAtMs: number;
  async: boolean;
  granules: number;
  ignoreErrors: boolean;
  steps: StepSpec[];
}

export interface ResolvedScenario {
  name: string;
  description: string;
  seed: number;
  maxDurationMs: number;
  policy: string;
  env: Record<string, string>;
  infrastructure: ResolvedInfrastructure;
  services: ResolvedService[];
  jobs: ResolvedJob[];
}

const UNITS_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Converts a duration to milliseconds.
 *
 * @param value - a number of milliseconds or a string such as "30s" or "1.5h"
 * @returns the duration in milliseconds
 * @throws Error - if the value is not a valid duration
 */
export function parseDuration(value: Duration): number {
  if (typeof value === 'number') {
    return value;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration "${value}" - use e.g. 250ms, 30s, 10m, 2h or 1d`);
  }
  return parseFloat(match[1]) * UNITS_MS[match[2]];
}

/**
 * Formats milliseconds as a short human readable duration.
 *
 * @param ms - the duration in milliseconds
 * @returns the formatted duration, e.g. "1h 05m" or "42.0s"
 */
export function formatDuration(ms: number): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) {
    return '-';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3_600_000) {
    const totalSeconds = Math.round(ms / 1000);
    return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
  }
  const totalMinutes = Math.round(ms / 60_000);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

/**
 * Draws a duration in milliseconds from a duration spec.
 *
 * @param spec - the duration spec
 * @param random - the random stream to draw from
 * @returns the duration in milliseconds (at least 1)
 * @throws Error - if the spec is not valid
 */
export function sampleDuration(spec: DurationSpec, random: Random): number {
  let ms: number;
  if (typeof spec === 'number' || typeof spec === 'string') {
    ms = parseDuration(spec);
  } else {
    switch (spec.dist) {
      case 'fixed':
        ms = parseDuration(spec.value);
        break;
      case 'uniform': {
        const min = parseDuration(spec.min);
        const max = parseDuration(spec.max);
        ms = min + random() * (max - min);
        break;
      }
      case 'exponential':
        ms = -Math.log(1 - random()) * parseDuration(spec.mean);
        break;
      case 'lognormal':
        ms = parseDuration(spec.median) * Math.exp(spec.sigma * standardNormal(random));
        break;
      case 'mix': {
        const total = spec.options.reduce((sum, o) => sum + o.weight, 0);
        let pick = random() * total;
        const option = spec.options.find((o) => {
          pick -= o.weight;
          return pick < 0;
        }) || spec.options[spec.options.length - 1];
        ms = sampleDuration(option.duration, random);
        break;
      }
      default:
        throw new Error(`Unknown duration distribution in ${JSON.stringify(spec)}`);
    }
  }
  return Math.max(1, Math.round(ms));
}

/**
 * Returns the duration spec that applies to the given work item of a step.
 *
 * @param step - the step spec
 * @param itemIndex - the index of the work item within the job (its sort index)
 * @returns the duration spec
 */
export function durationSpecForItem(step: StepSpec, itemIndex: number): DurationSpec {
  let spec = step.duration;
  for (const phase of step.phases || []) {
    if (itemIndex >= phase.fromItem) {
      spec = phase.duration;
    }
  }
  return spec;
}

/**
 * Picks the number of granules for a job.
 *
 * @param granules - a fixed count or a uniform integer range
 * @param random - the random stream to draw from
 * @returns the number of granules
 */
function resolveGranules(granules: JobTemplate['granules'], random: Random): number {
  if (typeof granules === 'number') {
    return granules;
  }
  return granules.min + Math.floor(random() * (granules.max - granules.min + 1));
}

/**
 * Expands the generators in a scenario into concrete jobs.
 *
 * @param generator - the generator spec
 * @param seed - the scenario seed
 * @param maxDurationMs - the simulation end time
 * @returns the generated jobs
 */
function expandGenerator(generator: GeneratorSpec, seed: number, maxDurationMs: number): ResolvedJob[] {
  const random = rngFor(seed, 'generator', generator.name);
  const untilMs = generator.until === undefined ? maxDurationMs : parseDuration(generator.until);
  const count = generator.count ?? Number.MAX_SAFE_INTEGER;
  const jobs: ResolvedJob[] = [];
  let t = generator.start === undefined ? 0 : parseDuration(generator.start);
  while (jobs.length < count && t < untilMs) {
    jobs.push({
      name: `${generator.name}-${jobs.length + 1}`,
      user: generator.user,
      submitAtMs: t,
      async: generator.job.async ?? true,
      granules: resolveGranules(generator.job.granules, random),
      ignoreErrors: generator.job.ignoreErrors ?? true,
      steps: generator.job.steps,
    });
    t += sampleDuration(generator.every, random);
  }
  return jobs;
}

/**
 * Validates and fills in defaults for a scenario.
 *
 * @param scenario - the scenario as parsed from the file
 * @returns the resolved scenario
 * @throws Error - if the scenario is invalid
 */
export function resolveScenario(scenario: Scenario): ResolvedScenario {
  if (!scenario?.name) {
    throw new Error('Scenario must have a name');
  }
  if (!scenario.services?.length) {
    throw new Error('Scenario must define at least one service');
  }
  const seed = scenario.seed ?? 1;
  const maxDurationMs = parseDuration(scenario.maxDuration ?? '7d');
  const infra = scenario.infrastructure || {};
  const services = scenario.services.map((s) => ({
    name: s.name,
    id: s.id || `harmonyservices/sim-${s.name}:latest`,
    pods: s.pods,
  }));
  const serviceNames = new Set(services.map((s) => s.name));

  const explicitJobs: ResolvedJob[] = (scenario.jobs || []).map((j) => ({
    name: j.name,
    user: j.user,
    submitAtMs: j.submitAt === undefined ? 0 : parseDuration(j.submitAt),
    async: j.async ?? true,
    granules: resolveGranules(j.granules, rngFor(seed, 'granules', j.name)),
    ignoreErrors: j.ignoreErrors ?? true,
    steps: j.steps,
  }));
  const generatedJobs = (scenario.generators || []).flatMap((g) => expandGenerator(g, seed, maxDurationMs));
  // stable order by submit time, keeping the file order for ties
  const jobs = [...explicitJobs, ...generatedJobs]
    .map((job, index) => ({ job, index }))
    .sort((a, b) => a.job.submitAtMs - b.job.submitAtMs || a.index - b.index)
    .map(({ job }) => job);

  const names = new Set<string>();
  for (const job of jobs) {
    if (!job.name || !job.user) {
      throw new Error(`Every job needs a name and a user: ${JSON.stringify(job)}`);
    }
    if (names.has(job.name)) {
      throw new Error(`Duplicate job name ${job.name}`);
    }
    names.add(job.name);
    if (!job.steps?.length) {
      throw new Error(`Job ${job.name} has no steps`);
    }
    if (!(job.granules > 0)) {
      throw new Error(`Job ${job.name} must have at least one granule`);
    }
    const stepServices = new Set<string>();
    for (const step of job.steps) {
      if (!serviceNames.has(step.service)) {
        throw new Error(`Job ${job.name} uses unknown service ${step.service}`);
      }
      if (stepServices.has(step.service)) {
        // user_work has one row per job and service, as in Harmony
        throw new Error(`Job ${job.name} uses service ${step.service} more than once`);
      }
      stepServices.add(step.service);
      sampleDuration(step.duration, () => 0.5); // validates the spec
    }
  }

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(scenario.env || {})) {
    env[k] = String(v);
  }

  return {
    name: scenario.name,
    description: scenario.description || '',
    seed,
    maxDurationMs,
    policy: scenario.policy || 'baseline',
    env,
    infrastructure: {
      schedulerPods: infra.schedulerPods ?? 1,
      updaterPods: infra.updaterPods ?? 1,
      schedulerWakeLatencyMs: parseDuration(infra.schedulerWakeLatency ?? '50ms'),
      updaterWakeLatencyMs: parseDuration(infra.updaterWakeLatency ?? '50ms'),
      schedulerPassTimeMs: parseDuration(infra.schedulerPassTime ?? '200ms'),
      updaterBatchTimeMs: parseDuration(infra.updaterBatchTime ?? '100ms'),
      podReceiveLatencyMs: parseDuration(infra.podReceiveLatency ?? '50ms'),
      podPollIntervalMs: parseDuration(infra.podPollInterval ?? '500ms'),
      sampleIntervalMs: parseDuration(infra.sampleInterval ?? '30s'),
    },
    services,
    jobs,
  };
}

/**
 * Reads, validates and resolves a scenario file.
 *
 * @param file - path to the YAML (or JSON) scenario file
 * @param seed - if given, used instead of the scenario's own seed
 * @returns the resolved scenario
 */
export function loadScenario(file: string, seed?: number): ResolvedScenario {
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as Scenario;
  if (seed !== undefined) parsed.seed = seed;
  return resolveScenario(parsed);
}
