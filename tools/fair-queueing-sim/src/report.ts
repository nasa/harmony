import * as fs from 'fs';
import * as path from 'path';

import { Summary } from './metrics';
import { formatDuration } from './scenario';
import { RunResult } from './simulation';

// comparisons list every job only for scenarios with at most this many jobs
const MAX_COMPARISON_JOBS = 30;

/**
 * Formats a number with a fixed number of decimals, or '-' for null.
 *
 * @param n - the number
 * @param digits - number of decimals
 * @returns the formatted number
 */
function num(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || Number.isNaN(n) ? '-' : n.toFixed(digits);
}

/**
 * Formats a pod time in pod-hours.
 *
 * @param ms - pod time in milliseconds
 * @returns the formatted pod-hours
 */
function podHours(ms: number): string {
  return (ms / 3_600_000).toFixed(2);
}

/**
 * Renders a Markdown table.
 *
 * @param header - the column headings
 * @param rows - the rows
 * @returns the table
 */
function table(header: string[], rows: string[][]): string {
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

/**
 * Renders the Markdown report for a single run.
 *
 * @param s - the summary
 * @returns the report
 */
export function renderRunReport(s: Summary): string {
  const out: string[] = [];
  out.push(`# ${s.scenario} - policy \`${s.policy}\``, '');
  if (s.description) out.push(s.description.trim(), '');
  out.push(
    `Simulated ${formatDuration(s.endMs)} in ${formatDuration(s.wallMs)} of wall time ` +
    `(${Math.round(s.speedup)}x real time, ${s.eventsRun} events, ${s.passes} scheduling passes).` +
    (s.completed ? '' : ' **The time limit was reached before all jobs finished.**'),
    '',
  );

  out.push('## Services', '');
  out.push(table(
    ['service', 'pods', 'busy pod-h', 'utilization', 'idle while work ready (pod-h)', 'contended fairness'],
    s.services.map((svc) => [
      svc.service, String(svc.pods), podHours(svc.busyPodMs), `${num(svc.utilizationPct, 1)}%`,
      podHours(svc.idleWhileReadyPodMs), `${num(svc.contendedFairness)} (${svc.contendedSamples} samples)`,
    ]),
  ), '');
  const policyKeys = [...new Set(s.services.flatMap((svc) => Object.keys(svc.policy)))];
  if (policyKeys.length) {
    out.push('Policy state (max / time-weighted mean):', '');
    out.push(table(
      ['service', ...policyKeys],
      s.services.map((svc) => [
        svc.service, ...policyKeys.map((k) => (svc.policy[k] ? `${num(svc.policy[k].max, 1)} / ${num(svc.policy[k].mean, 2)}` : '-')),
      ]),
    ), '');
  }

  out.push('## Users', '');
  out.push(
    'Fair share is the pods a user had divided by their max-min fair share of the pods, over the ' +
    'times they were competing with other users for a service (1.00 = exactly their fair share).', '',
  );
  out.push(table(
    ['user', 'jobs', 'pod-h', 'share of all pod time', 'fair share', 'mean slowdown', 'max slowdown'],
    s.users.map((u) => [
      u.user, String(u.jobs), podHours(u.podTimeMs), `${num(u.sharePct, 1)}%`, num(u.fairShareRatio),
      num(u.meanSlowdown), num(u.maxSlowdown),
    ]),
  ), '');

  out.push('## Jobs', '');
  out.push(
    'Slowdown is the makespan divided by a lower bound on how long the job would take with the ' +
    'cluster to itself; wait is the time from a work item being ready to a pod starting it.', '',
  );
  out.push(table(
    ['job', 'user', 'type', 'granules', 'submitted', 'first start', 'finished', 'makespan', 'alone (lower bound)', 'slowdown', 'mean wait', 'p95 wait', 'status'],
    s.jobs.map((j) => [
      j.name, j.user, j.async ? 'async' : 'sync', String(j.granules), formatDuration(j.submitMs),
      formatDuration(j.firstStartMs), formatDuration(j.endMs), formatDuration(j.makespanMs),
      formatDuration(j.aloneLowerBoundMs), num(j.slowdown), formatDuration(j.meanWaitMs), formatDuration(j.p95WaitMs),
      j.status,
    ]),
  ), '');
  return out.join('\n');
}

/**
 * Writes the raw results of a run to its output directory as JSON / newline-delimited JSON.
 *
 * @param runDir - the output directory
 * @param result - the run results
 * @param summary - the summary metrics
 */
export function writeRunOutputs(runDir: string, result: RunResult, summary: Summary): void {
  const ndjson = (file: string, rows: unknown[]): void => {
    fs.writeFileSync(path.join(runDir, file), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  };
  ndjson('decisions.ndjson', result.decisions);
  ndjson('runs.ndjson', result.runs);
  ndjson('samples.ndjson', result.samples);
  ndjson('work-items.ndjson', result.workItems);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(runDir, 'report.md'), renderRunReport(summary));
}

export interface ComparisonTable {
  caption: string;
  header: string[];
  rows: string[][];
}

/**
 * Builds the tables comparing runs of the same scenario under different policies.
 *
 * @param summaries - one summary per policy, all for the same scenario
 * @returns the tables, plus a note when there were too many jobs to list
 */
export function comparisonTables(summaries: Summary[]): { tables: ComparisonTable[]; note?: string } {
  const [first] = summaries;
  const cols = summaries.map((s) => s.policy);
  const tables: ComparisonTable[] = [];

  const rows: string[][] = [];
  rows.push(['simulated time', ...summaries.map((s) => formatDuration(s.endMs) + (s.completed ? '' : ' (time limit)'))]);
  rows.push(['mean / max job slowdown', ...summaries.map((s) => `${num(s.overall.meanSlowdown)} / ${num(s.overall.maxSlowdown)}`)]);
  if (first.sync.jobs > 0) {
    rows.push(['sync makespan mean / max', ...summaries.map((s) => `${formatDuration(s.sync.meanMakespanMs)} / ${formatDuration(s.sync.maxMakespanMs)}`)]);
  }
  for (const svc of first.services) {
    const of = (s: Summary): Summary['services'][number] => s.services.find((x) => x.service === svc.service);
    rows.push([`${svc.service}: utilization`, ...summaries.map((s) => `${num(of(s).utilizationPct, 1)}%`)]);
    rows.push([`${svc.service}: idle while work ready (pod-h)`, ...summaries.map((s) => podHours(of(s).idleWhileReadyPodMs))]);
    rows.push([`${svc.service}: contended fairness`, ...summaries.map((s) => num(of(s).contendedFairness))]);
    const policyKeys = [...new Set(summaries.flatMap((s) => Object.keys(of(s).policy)))];
    for (const key of policyKeys) {
      rows.push([`${svc.service}: ${key} (max / mean)`, ...summaries.map((s) => {
        const v = of(s).policy[key];
        return v ? `${num(v.max, 1)} / ${num(v.mean, 2)}` : '-';
      })]);
    }
  }
  tables.push({ caption: 'Overall', header: ['metric', ...cols], rows });

  tables.push({
    caption: 'Users - fair share while competing (1.00 = exactly their share) / mean job slowdown',
    header: ['user', 'jobs', ...cols],
    rows: first.users.map((u) => [
      u.user, String(u.jobs),
      ...summaries.map((s) => {
        const user = s.users.find((x) => x.user === u.user);
        return `${num(user.fairShareRatio)} / ${num(user.meanSlowdown)}`;
      }),
    ]),
  });

  if (first.jobs.length > MAX_COMPARISON_JOBS) {
    return { tables, note: `${first.jobs.length} jobs - see each run's report.md for per-job results.` };
  }
  tables.push({
    caption: 'Job makespans (slowdown)',
    header: ['job', 'user', 'type', 'granules', 'submitted', ...cols],
    rows: first.jobs.map((j) => [
      j.name, j.user, j.async ? 'async' : 'sync', String(j.granules), formatDuration(j.submitMs),
      ...summaries.map((s) => {
        const job = s.jobs.find((x) => x.name === j.name);
        return `${formatDuration(job.makespanMs)} (${num(job.slowdown)})`;
      }),
    ]),
  });
  return { tables };
}

/**
 * Renders a Markdown comparison of runs of the same scenario under different policies.
 *
 * @param summaries - one summary per policy, all for the same scenario
 * @returns the comparison
 */
export function renderComparison(summaries: Summary[]): string {
  const [first] = summaries;
  const out: string[] = [`## ${first.scenario}`, ''];
  if (first.description) out.push(first.description.trim(), '');
  const { tables, note } = comparisonTables(summaries);
  for (const t of tables) {
    out.push(`${t.caption}:`, '', table(t.header.map((h, i) => (i >= t.header.length - summaries.length ? `\`${h}\`` : h)), t.rows), '');
  }
  if (note) out.push(note, '');
  return out.join('\n');
}
