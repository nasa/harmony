import type { JobSummary, Summary, UserSummary } from './metrics';
import { formatDuration } from './scenario';

//
// The metrics the `bench` command records for each run, and how to read them from the run's
// summary. Each has a key - a scenario wide name such as "overall.meanSlowdown", or
// "job.<job>.<field>" / "user.<user>.<field>" - which is what scenario files name in their
// `benchmarks:` list of protected metrics. Changing these changes what gets recorded, so this
// file counts as code that affects results (see resultCodeHash in provenance.ts).
//

export type Better = 'lower' | 'higher';
export type MetricFormat = 'duration' | 'ratio' | 'percent' | 'podHours';

export interface MetricKind {
  label: string;
  better: Better;
  format: MetricFormat;
}

interface Extractor<T> extends MetricKind {
  value: (from: T) => number | null;
}

/**
 * Returns the mean of the values, or null if there are none.
 *
 * @param values - the values
 * @returns the mean
 */
export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// metrics of the whole scenario, by key
const SCENARIO_METRICS: Record<string, Extractor<Summary>> = {
  'overall.meanSlowdown': { label: 'mean job slowdown', better: 'lower', format: 'ratio', value: (s) => s.overall.meanSlowdown },
  'overall.maxSlowdown': { label: 'max job slowdown', better: 'lower', format: 'ratio', value: (s) => s.overall.maxSlowdown },
  'sync.meanMakespan': { label: 'sync makespan (mean)', better: 'lower', format: 'duration', value: (s) => s.sync.meanMakespanMs },
  'sync.maxMakespan': { label: 'sync makespan (max)', better: 'lower', format: 'duration', value: (s) => s.sync.maxMakespanMs },
  'fairness': {
    label: 'contended fairness',
    better: 'higher',
    format: 'ratio',
    value: (s) => mean(s.services.map((x) => x.contendedFairness).filter((v) => v !== null)),
  },
  'utilization': { label: 'utilization', better: 'higher', format: 'percent', value: (s) => mean(s.services.map((x) => x.utilizationPct)) },
  'idlePodHours': {
    label: 'idle while work ready',
    better: 'lower',
    format: 'podHours',
    value: (s) => s.services.reduce((sum, x) => sum + x.idleWhileReadyPodMs, 0) / 3_600_000,
  },
  'simulatedTime': { label: 'simulated time', better: 'lower', format: 'duration', value: (s) => s.endMs },
};

const JOB_METRICS: Record<string, Extractor<JobSummary>> = {
  makespan: { label: 'makespan', better: 'lower', format: 'duration', value: (j) => j.makespanMs },
  slowdown: { label: 'slowdown', better: 'lower', format: 'ratio', value: (j) => j.slowdown },
  meanWait: { label: 'mean wait', better: 'lower', format: 'duration', value: (j) => j.meanWaitMs },
};

const USER_METRICS: Record<string, Extractor<UserSummary>> = {
  fairShare: { label: 'fair share', better: 'higher', format: 'ratio', value: (u) => u.fairShareRatio },
  meanSlowdown: { label: 'mean slowdown', better: 'lower', format: 'ratio', value: (u) => u.meanSlowdown },
  maxSlowdown: { label: 'max slowdown', better: 'lower', format: 'ratio', value: (u) => u.maxSlowdown },
};

/**
 * Describes a metric key.
 *
 * @param key - the metric key, e.g. "overall.meanSlowdown" or "job.bob-sync.makespan"
 * @returns its label, which direction is better and how to format it, or null if it isn't a
 * metric key
 */
export function metricKind(key: string): MetricKind | null {
  const scenarioMetric = SCENARIO_METRICS[key];
  if (scenarioMetric) return scenarioMetric;
  const match = /^(job|user)\.(.+)\.([^.]+)$/.exec(key);
  if (!match) return null;
  const field = (match[1] === 'job' ? JOB_METRICS : USER_METRICS)[match[3]];
  return field ? { label: `${match[2]} ${field.label}`, better: field.better, format: field.format } : null;
}

/**
 * Describes the metric keys there are, for error messages.
 *
 * @returns a description of the keys
 */
export function metricKeysHelp(): string {
  return `${Object.keys(SCENARIO_METRICS).join(', ')}, job.<job>.{${Object.keys(JOB_METRICS).join(',')}} ` +
    `or user.<user>.{${Object.keys(USER_METRICS).join(',')}}`;
}

/**
 * Rounds a metric value for recording, so recorded files are stable and readable.
 *
 * @param value - the value
 * @param format - the metric's format
 * @returns the rounded value, or null if there is none
 */
function round(value: number | null, format: MetricFormat): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return format === 'duration' ? Math.round(value) : Math.round(value * 10_000) / 10_000;
}

/**
 * Reads every metric from a run's summary: the scenario wide ones, then each job's, then each
 * user's.
 *
 * @param s - the run's summary
 * @returns the metric values, by key
 */
export function extractMetrics(s: Summary): Record<string, number | null> {
  const metrics: Record<string, number | null> = {};
  for (const [key, m] of Object.entries(SCENARIO_METRICS)) metrics[key] = round(m.value(s), m.format);
  for (const job of s.jobs) {
    for (const [field, m] of Object.entries(JOB_METRICS)) metrics[`job.${job.name}.${field}`] = round(m.value(job), m.format);
  }
  for (const user of s.users) {
    for (const [field, m] of Object.entries(USER_METRICS)) metrics[`user.${user.user}.${field}`] = round(m.value(user), m.format);
  }
  return metrics;
}

/**
 * Formats a metric value.
 *
 * @param value - the value
 * @param format - the metric's format
 * @returns the formatted value
 */
export function formatMetric(value: number, format: MetricFormat): string {
  switch (format) {
    case 'duration':
      return formatDuration(value);
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'podHours':
      return `${value.toFixed(2)} pod-h`;
    default:
      return value.toFixed(2);
  }
}
