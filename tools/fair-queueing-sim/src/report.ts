import * as fs from 'fs';
import * as path from 'path';

import { Summary } from './metrics';
import { POLICY_CATALOG } from './policies/catalog';
import { describeCode } from './provenance';
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

export const README_PATH = 'tools/fair-queueing-sim/README.md';

// short definitions of the metrics, repeated in every report so it can be read on its own
export const GLOSSARY: [string, string][] = [
  ['makespan', 'time from a job\'s submission to its completion'],
  ['slowdown', 'makespan divided by a lower bound on how long the job would take with the cluster to itself; 1.0 is as fast as possible'],
  ['wait', 'time from a work item being ready to a pod starting it'],
  ['fair share', 'while a user competed with others for a service: the pods running their work divided by their max-min fair share of the pods; 1.00 is exactly fair, below 1 short-changed, above 1 more than their share. Measured in pods, not work done, so users with very short work items can look short-changed while being served well'],
  ['contended fairness', 'Jain\'s index of the per-user fair share ratios, averaged over the times two or more users wanted the service; 1.0 = everyone had exactly their share'],
  ['utilization', 'pod time spent running work divided by pods x simulated time'],
  ['idle while work ready', 'pod-hours spent idle while the service had work ready or queued - either a policy deliberately holding work back (e.g. a reserve) or pods being left unused'],
  ['policy rows', 'values recorded by the policy, as max / time-weighted mean - e.g. slowRunning (slow work items in flight), slowCapacity (the most slow work allowed), fastLaneOnly (1 while slow work is capped), slowJobs ((job, service)s classified slow), unmeasuredRunning (work items running for jobs not yet measured)'],
];

/**
 * Renders the glossary as Markdown.
 *
 * @returns the glossary
 */
export function renderGlossary(): string {
  return [
    `Definitions (full details, and how to dig further, in ${README_PATH}):`, '',
    ...GLOSSARY.map(([term, definition]) => `- **${term}** - ${definition}`), '',
    'Differences of a few percent between policies, or a few seconds on short jobs, can be noise - ' +
    'rerun with a few --seed values before relying on them.',
  ].join('\n');
}

/**
 * Describes what produced a run: code, seed, policy settings and overrides.
 *
 * @param s - the run's summary
 * @returns a one line description
 */
export function describeRun(s: Summary): string {
  const p = s.provenance;
  if (!p) return 'unknown (no provenance recorded)';
  const settings = Object.entries(p.policySettings || {}).map(([k, v]) => `${k}=${v}`);
  const overrides = Object.entries(p.envOverrides || {}).map(([k, v]) => `${k}=${v}`);
  return `code ${describeCode(p)}; seed ${p.seed}` +
    (settings.length ? `; policy settings ${settings.join(', ')}` : '') +
    (overrides.length ? `; overrides ${overrides.join(', ')}` : '');
}

/**
 * Lists the ways in which the runs of a comparison weren't made from the same code, seed and
 * overrides, so the comparison isn't like for like.
 *
 * @param summaries - the runs being compared
 * @returns a description of each difference (empty if the runs are comparable)
 */
export function comparabilityWarnings(summaries: Summary[]): string[] {
  const warnings: string[] = [];
  const distinct = (f: (s: Summary) => unknown): number => new Set(summaries.map((s) => JSON.stringify(f(s)))).size;
  if (summaries.some((s) => !s.provenance)) warnings.push('some runs have no provenance recorded');
  if (distinct((s) => [s.provenance?.commit, s.provenance?.changesHash]) > 1) warnings.push('the runs used different code');
  if (distinct((s) => s.provenance?.seed) > 1) warnings.push('the runs used different seeds');
  if (distinct((s) => s.provenance?.envOverrides) > 1) warnings.push('the runs used different environment overrides');
  return warnings;
}

/**
 * The design notes of the given policies, from the policy catalog.
 *
 * @param policies - policy names
 * @returns the notes, deduplicated
 */
export function designNotes(policies: string[]): string[] {
  return [...new Set(policies.flatMap((p) => POLICY_CATALOG[p]?.designNotes || []))];
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
  if (s.goodOutcome) out.push(`**What a good result looks like:** ${s.goodOutcome.trim()}`, '');
  out.push(`Produced by: ${describeRun(s)}.`, '');
  for (const note of designNotes([s.policy])) out.push(`**Design note:** ${note}`, '');
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
  out.push('## How to read this report', '', renderGlossary(), '');
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
 * Renders the top of comparison.md: the policies, their design notes and the glossary.
 *
 * @param policies - the policies compared
 * @returns the header
 */
export function renderComparisonHeader(policies: string[]): string {
  const out = ['# Fair queueing policy comparison', '', 'Policies:', ''];
  for (const p of policies) out.push(`- \`${p}\` - ${POLICY_CATALOG[p]?.description ?? ''}`);
  out.push('');
  for (const note of designNotes(policies)) out.push(`**Design note:** ${note}`, '');
  out.push(renderGlossary(), '');
  return out.join('\n');
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
  if (first.goodOutcome) out.push(`**What a good result looks like:** ${first.goodOutcome.trim()}`, '');
  const warnings = comparabilityWarnings(summaries);
  if (warnings.length) {
    out.push(`**Not a like for like comparison:** ${warnings.join('; ')}.`, '');
    for (const s of summaries) out.push(`- \`${s.policy}\`: ${describeRun(s)}`);
    out.push('');
  } else {
    out.push(`Produced by: code ${describeCode(first.provenance)}; seed ${first.provenance?.seed}. ` +
      'Policy settings are in each run\'s summary.json.', '');
  }
  const { tables, note } = comparisonTables(summaries);
  for (const t of tables) {
    out.push(`${t.caption}:`, '', table(t.header.map((h, i) => (i >= t.header.length - summaries.length ? `\`${h}\`` : h)), t.rows), '');
  }
  if (note) out.push(note, '');
  return out.join('\n');
}
