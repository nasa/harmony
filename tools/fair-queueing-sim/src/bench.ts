import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import * as yaml from 'js-yaml';

import { RunTask, runTasks, SIM_ROOT } from './batch';
import { extractMetrics, formatMetric, mean, metricKeysHelp, MetricKind, metricKind } from './bench-metrics';
import { REPO_ROOT } from './bootstrap';
import type { Summary } from './metrics';
import { POLICY_CATALOG, POLICY_NAMES, resolvedSettings } from './policies/catalog';
import { describeCode, GitState, gitState, resultCodeHash } from './provenance';
import { BenchmarkMetricSpec, loadScenario, ResolvedScenario } from './scenario';

//
// The `bench` command: runs the benchmark suite (benchmarks/suite.yml) for the policies being
// worked on and compares each scenario's metrics with baseline's (Harmony's current algorithm)
// and with each policy's own previously recorded results. `--record` saves the results to
// benchmarks/results/<policy>.json, to be committed with the code that produced them, and
// `--label` saves them to benchmarks/experiments/ as a log of what each version of a policy
// achieved.
//
// Runs are deterministic, so baseline's recorded results stay valid until something that can
// change them does: the code (other than other policies' - see resultCodeHash), a scenario,
// the seeds or the settings. Until then baseline isn't rerun; after that its record is
// reported as stale and baseline is run afresh.
//

export const DEFAULT_SUITE = path.join(SIM_ROOT, 'benchmarks', 'suite.yml');
const RESULTS_DIR = path.join(SIM_ROOT, 'benchmarks', 'results');
const EXPERIMENTS_DIR = path.join(SIM_ROOT, 'benchmarks', 'experiments');
// the policy every other policy is compared with: Harmony's current algorithm
const REFERENCE_POLICY = 'baseline';
// where Harmony's own environment variables are declared, with their defaults
const ENV_DEFAULTS_FILES = [
  'services/harmony/env-defaults', 'services/work-scheduler/env-defaults',
  'services/work-updater/env-defaults', 'packages/util/env-defaults',
];
// scenario fields that don't affect results (bench always sets the seed and the policy), left
// out of a scenario's hash so editing them doesn't make recorded results stale
const NON_RESULT_FIELDS = ['description', 'goodOutcome', 'benchmarks', 'seed', 'policy'];

export interface Suite {
  file: string;
  scenarios: string[];
  seeds: number[];
  // the policies whose results are recorded in benchmarks/results
  policies: string[];
  // environment overrides for every run
  set: Record<string, string>;
}

// a policy's results for one scenario: each metric's value per seed
type Values = Record<string, (number | null)[]>;

interface ScenarioRecord {
  // the scenario file, relative to the simulator directory
  file: string;
  // hash of the scenario's result-affecting fields
  hash: string;
  // each metric's value for each of the record's seeds, in order
  metrics: Values;
}

export interface BenchRecord {
  policy: string;
  // for experiment logs
  label?: string;
  code: GitState & { codeHash: string | null; node: string; platform: string; recordedAt: string };
  seeds: number[];
  // the settings that can affect this policy's results (see relevantSet)
  set: Record<string, string>;
  policySettings: Record<string, string>;
  scenarios: Record<string, ScenarioRecord>;
}

export interface BenchOptions {
  suiteFile: string;
  // scenario files to run instead of the suite's
  files: string[];
  // the policies to run (default: the suite's)
  policies?: string[];
  // the seeds to use (default: the suite's)
  seeds?: number[];
  sets: Record<string, string>;
  record: boolean;
  label?: string;
  outDir: string;
  parallel?: number;
  // the command line, for the report
  command: string;
}

// what a policy's current code and settings would record
interface PolicyState {
  codeHash: string | null;
  set: Record<string, string>;
  policySettings: Record<string, string>;
}

interface BenchScenario {
  file: string;
  scenario: ResolvedScenario;
  hash: string;
}

// per scenario: the values, or the reason there are none
type ScenarioValues = Record<string, Values | string>;

// a policy's comparison with its own recorded results
interface OwnComparison {
  // null if there's nothing to compare with
  values: ScenarioValues | null;
  note: string;
}

interface ReportContext {
  options: BenchOptions;
  suite: Suite;
  policies: string[];
  seeds: number[];
  set: Record<string, string>;
  scenarios: BenchScenario[];
  // baseline's values per scenario, from this run or from its record
  reference: ScenarioValues;
  baselineNote: string;
  // why baseline was run afresh, per scenario
  baselineReasons: Record<string, string>;
  fresh: Record<string, ScenarioValues>;
  own: Record<string, OwnComparison>;
}

interface Column {
  heading: string;
  cell: (scenario: string, key: string, kind: MetricKind) => string;
}

/**
 * JSON with object keys sorted, so equal values give equal strings.
 *
 * @param value - the value
 * @returns the JSON
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Pretty printed JSON with arrays of plain values on one line, so recorded files stay readable
 * and their diffs show which metrics changed.
 *
 * @param value - the value
 * @returns the JSON
 */
function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/\[\n\s+([^[\]{}]*?)\n\s+\]/g, (_, inner: string) => `[${inner.split(/,\n\s+/).join(', ')}]`);
}

/**
 * Expands a scenario file pattern, which may have "*" wildcards in its file name.
 *
 * @param pattern - the pattern
 * @param baseDir - the directory it's relative to
 * @returns the matching files, sorted
 * @throws Error - if a file without wildcards doesn't exist
 */
function expandPattern(pattern: string, baseDir: string): string[] {
  const full = path.resolve(baseDir, pattern);
  const base = path.basename(full);
  if (!base.includes('*')) {
    if (!fs.existsSync(full)) throw new Error(`Benchmark scenario ${pattern} not found`);
    return [full];
  }
  const re = new RegExp(`^${base.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const dir = path.dirname(full);
  return fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f));
}

/**
 * Reads the benchmark suite.
 *
 * @param file - the suite file
 * @returns the suite
 * @throws Error - if the suite is invalid
 */
export function loadSuite(file: string): Suite {
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as {
    scenarios?: string[]; seeds?: number[]; policies?: string[]; set?: Record<string, string | number | boolean>;
  };
  if (!Array.isArray(parsed?.scenarios) || parsed.scenarios.length === 0) {
    throw new Error(`${file}: scenarios must list at least one scenario file`);
  }
  if (!Array.isArray(parsed.seeds) || parsed.seeds.length === 0 || !parsed.seeds.every(Number.isInteger)) {
    throw new Error(`${file}: seeds must be a list of integers`);
  }
  const policies = parsed.policies || [REFERENCE_POLICY];
  for (const policy of policies) {
    if (!POLICY_NAMES.includes(policy)) throw new Error(`${file}: unknown policy "${policy}"`);
  }
  const scenarios = [...new Set(parsed.scenarios.flatMap((p) => expandPattern(p, path.dirname(file))))];
  const set = Object.fromEntries(Object.entries(parsed.set || {}).map(([k, v]) => [k, String(v)]));
  return { file, scenarios, seeds: parsed.seeds, policies, set };
}

/**
 * Hashes the parts of a scenario file that can affect results.
 *
 * @param file - the scenario file
 * @returns the hash
 */
function scenarioHash(file: string): string {
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  for (const field of NON_RESULT_FIELDS) delete parsed[field];
  return createHash('sha256').update(stableJson(parsed)).digest('hex').slice(0, 16);
}

/**
 * The environment variables Harmony itself reads, according to its env-defaults files.
 *
 * @returns the variable names
 */
function harmonyEnvKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of ENV_DEFAULTS_FILES) {
    const absolute = path.join(REPO_ROOT, file);
    if (!fs.existsSync(absolute)) continue;
    for (const [, key] of fs.readFileSync(absolute, 'utf8').matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) keys.add(key);
  }
  return keys;
}

/**
 * The settings that can affect a policy's results: all of them except those only other
 * policies read (settings in another policy's catalog entry that Harmony itself doesn't read).
 * So, e.g., trying ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT=4 doesn't stop baseline's recorded
 * results being used, but SLOW_WORK_THRESHOLD_MS, which the work-scheduler reads, does.
 *
 * @param policy - the policy
 * @param set - the settings
 * @param harmonyKeys - the variables Harmony reads
 * @returns the relevant settings
 */
function relevantSet(policy: string, set: Record<string, string>, harmonyKeys: Set<string>): Record<string, string> {
  const own = new Set((POLICY_CATALOG[policy]?.settings || []).map((s) => s.env));
  const others = new Set(Object.entries(POLICY_CATALOG)
    .filter(([name]) => name !== policy)
    .flatMap(([, info]) => info.settings.map((s) => s.env)));
  return Object.fromEntries(Object.entries(set).filter(([k]) => own.has(k) || !others.has(k) || harmonyKeys.has(k)));
}

/**
 * What the current code and settings would record for a policy.
 *
 * @param policy - the policy
 * @param set - the settings for the runs
 * @param harmonyKeys - the variables Harmony reads
 * @returns the state
 */
function policyState(policy: string, set: Record<string, string>, harmonyKeys: Set<string>): PolicyState {
  const relevant = relevantSet(policy, set, harmonyKeys);
  return {
    codeHash: resultCodeHash(policy),
    set: relevant,
    policySettings: resolvedSettings(policy, { ...process.env, ...relevant } as Record<string, string>),
  };
}

/**
 * Where a policy's recorded results are kept.
 *
 * @param policy - the policy
 * @returns the file
 */
function recordFile(policy: string): string {
  return path.join(RESULTS_DIR, `${policy}.json`);
}

/**
 * Reads a recorded result.
 *
 * @param file - the file
 * @returns the record, or null if there isn't one
 * @throws Error - if the file isn't valid JSON
 */
function readRecord(file: string): BenchRecord | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as BenchRecord;
  } catch (e) {
    throw new Error(`${path.relative(SIM_ROOT, file)} isn't valid JSON: ${e.message}`);
  }
}

/**
 * Describes a set of environment overrides.
 *
 * @param set - the overrides
 * @returns e.g. "A=1, B=2", or "none"
 */
function describeSet(set: Record<string, string>): string {
  const entries = Object.entries(set || {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(', ') : 'none';
}

/**
 * Why a record can't be compared like for like with runs using the given settings.
 *
 * @param record - the record
 * @param state - the current state for its policy
 * @returns the reasons (empty if it can be compared)
 */
function settingsProblems(record: BenchRecord, state: PolicyState): string[] {
  if (stableJson(record.set) !== stableJson(state.set)) {
    return [`it was recorded with settings ${describeSet(record.set)}, these runs use ${describeSet(state.set)}`];
  }
  return [];
}

/**
 * Describes how a policy's settings differ from a record's when the overrides are the same,
 * i.e. how the policy's settings or their defaults have changed - a change to the policy, like
 * a change to its code.
 *
 * @param record - the record
 * @param state - the current state for its policy
 * @returns the description, or null if they're the same
 */
function settingsChanges(record: BenchRecord, state: PolicyState): string | null {
  const keys = [...new Set([...Object.keys(record.policySettings), ...Object.keys(state.policySettings)])].sort();
  const changes = keys
    .filter((k) => record.policySettings[k] !== state.policySettings[k])
    .map((k) => `${k} ${record.policySettings[k] ?? '(new)'} -> ${state.policySettings[k] ?? '(removed)'}`);
  return changes.length ? changes.join(', ') : null;
}

/**
 * A record's values for a scenario and seeds.
 *
 * @param record - the record
 * @param s - the scenario
 * @param seeds - the seeds, in order
 * @returns the values, or the reason there are none
 */
function recordedValues(record: BenchRecord, s: BenchScenario, seeds: number[]): Values | string {
  const r = record.scenarios[s.scenario.name];
  if (!r) return 'it has no results for this scenario';
  if (r.hash !== s.hash) return 'the scenario has changed since it was recorded';
  const missing = seeds.filter((seed) => !record.seeds.includes(seed));
  if (missing.length) return `it has no results for seed${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`;
  const indexes = seeds.map((seed) => record.seeds.indexOf(seed));
  return Object.fromEntries(Object.entries(r.metrics).map(([k, v]) => [k, indexes.map((i) => v[i] ?? null)]));
}

/**
 * Where a run's output goes.
 *
 * @param outDir - the bench output directory
 * @param policy - the policy
 * @param scenario - the scenario name
 * @param seed - the seed
 * @returns the run directory
 */
function runDir(outDir: string, policy: string, scenario: string, seed: number): string {
  return path.join(outDir, 'runs', policy, scenario, `seed-${seed}`);
}

/**
 * Reads the metrics of this bench run's simulations of a scenario under a policy.
 *
 * @param outDir - the bench output directory
 * @param policy - the policy
 * @param scenario - the scenario name
 * @param seeds - the seeds, in order
 * @returns the values, or the reason there are none
 */
function freshValues(outDir: string, policy: string, scenario: string, seeds: number[]): Values | string {
  const perSeed = seeds.map((seed) => {
    const file = path.join(runDir(outDir, policy, scenario, seed), 'summary.json');
    return fs.existsSync(file) ? extractMetrics(JSON.parse(fs.readFileSync(file, 'utf8')) as Summary) : null;
  });
  if (perSeed.every((m) => m === null)) return 'its runs failed';
  const keys = [...new Set(perSeed.flatMap((m) => (m ? Object.keys(m) : [])))];
  return Object.fromEntries(keys.map((k) => [k, perSeed.map((m) => m?.[k] ?? null)]));
}

/**
 * Builds the record of a policy's results.
 *
 * @param policy - the policy
 * @param state - its current state
 * @param seeds - the seeds
 * @param scenarios - the scenarios
 * @param values - its values, per scenario
 * @param label - the experiment label, for experiment logs
 * @returns the record
 */
function buildRecord(
  policy: string, state: PolicyState, seeds: number[], scenarios: BenchScenario[], values: ScenarioValues, label?: string,
): BenchRecord {
  return {
    policy,
    ...(label ? { label } : {}),
    code: {
      ...gitState(),
      codeHash: state.codeHash,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      recordedAt: new Date().toISOString(),
    },
    seeds,
    set: state.set,
    policySettings: state.policySettings,
    scenarios: Object.fromEntries(scenarios.map((s) => [s.scenario.name, {
      file: path.relative(SIM_ROOT, s.file),
      hash: s.hash,
      metrics: values[s.scenario.name] as Values,
    }])),
  };
}

/**
 * Writes a record.
 *
 * @param file - the file
 * @param record - the record
 */
function writeRecord(file: string, record: BenchRecord): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${compactJson(record)}\n`);
}

/**
 * The values present in a list.
 *
 * @param values - the values, null where a run had none
 * @returns the values that aren't null
 */
function present(values: (number | null)[] | undefined): number[] {
  return (values || []).filter((v): v is number => v !== null && v !== undefined);
}

/**
 * A table cell for a metric's values: the mean over the seeds, with the range.
 *
 * @param values - the values per seed
 * @param kind - the metric
 * @returns the cell
 */
function valueCell(values: (number | null)[] | undefined, kind: MetricKind): string {
  const v = present(values);
  if (v.length === 0) return '-';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const m = formatMetric(mean(v), kind.format);
  return min === max ? m : `${m} (${formatMetric(min, kind.format)}–${formatMetric(max, kind.format)})`;
}

/**
 * A table cell comparing a metric's values with reference values, seed by seed: runs with the
 * same seed have the same work item durations, so a difference in every seed is a real one.
 *
 * @param values - the values per seed
 * @param reference - the reference values per seed
 * @param kind - the metric
 * @returns the cell
 */
function compareCell(values: (number | null)[] | undefined, reference: (number | null)[] | undefined, kind: MetricKind): string {
  const pairs = (values || [])
    .map((v, i): [number | null, number | null] => [v, reference?.[i] ?? null])
    .filter((p): p is [number, number] => p[0] !== null && p[0] !== undefined && p[1] !== null);
  if (pairs.length === 0) return '-';
  if (pairs.every(([a, b]) => a === b)) return 'same';
  const delta = mean(pairs.map((p) => p[0])) - mean(pairs.map((p) => p[1]));
  const referenceMean = mean(pairs.map((p) => p[1]));
  let sign = '±';
  if (delta > 0) sign = '+';
  else if (delta < 0) sign = '-';
  let text = `${sign}${formatMetric(Math.abs(delta), kind.format)}`;
  if (kind.format !== 'percent' && referenceMean !== 0) text += ` (${sign}${Math.abs((100 * delta) / referenceMean).toFixed(0)}%)`;
  const isBetter = ([a, b]: [number, number]): boolean => (kind.better === 'lower' ? a < b : a > b);
  const better = pairs.filter(isBetter).length;
  const worse = pairs.filter((p) => p[0] !== p[1] && !isBetter(p)).length;
  const n = pairs.length;
  if (n === 1) return `${text}, ${better ? 'better' : 'worse'} (1 seed)`;
  if (better === n) return `${text}, **better in ${n}/${n} seeds**`;
  if (worse === n) return `${text}, **worse in ${n}/${n} seeds**`;
  return `${text}, better in ${better}, worse in ${worse} of ${n} seeds`;
}

/**
 * Describes a protected metric, taking the scenario's direction override into account.
 *
 * @param spec - the scenario's benchmarks entry
 * @returns the metric
 */
function protectedKind(spec: BenchmarkMetricSpec): MetricKind {
  const kind = metricKind(spec.metric);
  return { ...kind, better: spec.better ?? kind.better };
}

/**
 * A metric's values from a scenario's values.
 *
 * @param values - the scenario's values, or the reason there are none
 * @param key - the metric key
 * @returns the metric's values per seed, if there are any
 */
function valuesOf(values: Values | string | undefined, key: string): (number | null)[] | undefined {
  return values && typeof values !== 'string' ? values[key] : undefined;
}

/**
 * Renders a Markdown table.
 *
 * @param header - the column headings
 * @param rows - the rows
 * @returns the table
 */
function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/**
 * The report's value columns: baseline, then each other policy with its comparisons.
 *
 * @param ctx - the report context
 * @returns the columns
 */
function columns(ctx: ReportContext): Column[] {
  const candidates = ctx.policies.filter((p) => p !== REFERENCE_POLICY);
  const prefix = (p: string): string => (candidates.length > 1 ? `\`${p}\` ` : '');
  const cols: Column[] = [{ heading: '`baseline`', cell: (s, key, kind) => valueCell(valuesOf(ctx.reference[s], key), kind) }];
  for (const p of candidates) {
    cols.push({ heading: `\`${p}\``, cell: (s, key, kind) => valueCell(valuesOf(ctx.fresh[p][s], key), kind) });
    cols.push({
      heading: `${prefix(p)}vs baseline`,
      cell: (s, key, kind) => compareCell(valuesOf(ctx.fresh[p][s], key), valuesOf(ctx.reference[s], key), kind),
    });
    if (ctx.own[p].values) {
      cols.push({
        heading: `${prefix(p)}vs recorded`,
        cell: (s, key, kind) => compareCell(valuesOf(ctx.fresh[p][s], key), valuesOf(ctx.own[p].values[s], key), kind),
      });
    }
  }
  if (ctx.policies.includes(REFERENCE_POLICY) && ctx.own[REFERENCE_POLICY].values) {
    cols.push({
      heading: '`baseline` vs recorded',
      cell: (s, key, kind) => compareCell(valuesOf(ctx.fresh[REFERENCE_POLICY][s], key), valuesOf(ctx.own[REFERENCE_POLICY].values[s], key), kind),
    });
  }
  return cols;
}

/**
 * Renders the summary at the top of the report.
 *
 * @param ctx - the report context
 * @returns the Markdown
 */
function renderHeader(ctx: ReportContext): string {
  const { options, suite } = ctx;
  const candidates = ctx.policies.filter((p) => p !== REFERENCE_POLICY);
  const scenarioSource = options.files.length
    ? `${ctx.scenarios.length} given on the command line`
    : `${ctx.scenarios.length} from ${path.relative(SIM_ROOT, suite.file)}`;
  const lines = [
    '# Fair queueing benchmark',
    '',
    `Produced by \`${options.command}\` on code ${describeCode(gitState())}.`,
    '',
    `- **Policies**: ${candidates.length
      ? `${candidates.map((p) => `\`${p}\``).join(', ')}, compared with \`baseline\``
      : '`baseline` only, compared with its recorded results'}`,
    `- **Scenarios**: ${scenarioSource}; **seeds**: ${ctx.seeds.join(', ')}; **settings**: ${describeSet(ctx.set)}`,
    `- **\`baseline\`**: ${ctx.baselineNote}`,
    ...ctx.policies.map((p) => `- **\`${p}\` vs recorded**: ${ctx.own[p].note}`),
    '',
    'Policies:',
    '',
    ...[...new Set([REFERENCE_POLICY, ...ctx.policies])].map((p) => `- \`${p}\` - ${POLICY_CATALOG[p].description}`),
    '',
    'Each value is the mean over the seeds, with the range across seeds in brackets. Comparisons ' +
      'are seed by seed: runs with the same seed have the same work item durations, so ' +
      '**better (or worse) in every seed** is a real difference, while a mixed count is within ' +
      'noise. **Protected metrics** are the ones each scenario names as expressing its goal ' +
      '(its `benchmarks:` list). Metric definitions are in tools/fair-queueing-sim/REFERENCE.md.',
  ];
  return lines.join('\n');
}

/**
 * Renders the table of every scenario's protected metrics.
 *
 * @param ctx - the report context
 * @returns the Markdown
 */
function renderProtected(ctx: ReportContext): string {
  const cols = columns(ctx);
  const rows = ctx.scenarios.flatMap(({ scenario }) => scenario.benchmarks.map((spec) => {
    const kind = protectedKind(spec);
    return [scenario.name, kind.label, ...cols.map((c) => c.cell(scenario.name, spec.metric, kind))];
  }));
  if (rows.length === 0) return '## Protected metrics\n\nNone of the scenarios name any (`benchmarks:` in the scenario file).';
  return `## Protected metrics\n\n${table(['scenario', 'metric', ...cols.map((c) => c.heading)], rows)}`;
}

/**
 * Renders one scenario's section: its goal, its protected metrics, its scenario wide metrics,
 * and (collapsed) every job's and user's metrics.
 *
 * @param ctx - the report context
 * @param s - the scenario
 * @returns the Markdown
 */
function renderScenario(ctx: ReportContext, s: BenchScenario): string {
  const { name } = s.scenario;
  const cols = columns(ctx);
  const header = ['metric', ...cols.map((c) => c.heading)];
  const protectedKeys = s.scenario.benchmarks.map((b) => b.metric);
  const keys = [...new Set([ctx.reference[name], ...ctx.policies.map((p) => ctx.fresh[p][name])]
    .flatMap((v) => (v && typeof v !== 'string' ? Object.keys(v) : [])))];
  const row = (key: string, kind: MetricKind, label: string): string[] => [label, ...cols.map((c) => c.cell(name, key, kind))];
  const isDetail = (k: string): boolean => k.startsWith('job.') || k.startsWith('user.');

  const lines = [`## ${name}`, ''];
  if (s.scenario.goodOutcome) lines.push(`**What a good result looks like:** ${s.scenario.goodOutcome}`, '');
  if (typeof ctx.reference[name] === 'string') {
    lines.push(`No \`baseline\` values to compare with: ${ctx.reference[name]}.`, '');
  } else if (ctx.baselineReasons[name]) {
    lines.push(`\`baseline\` was run afresh for this scenario: ${ctx.baselineReasons[name]}.`, '');
  }
  for (const p of ctx.policies) {
    if (typeof ctx.fresh[p][name] === 'string') lines.push(`No \`${p}\` values: ${ctx.fresh[p][name]}.`, '');
    const own = ctx.own[p].values?.[name];
    if (typeof own === 'string') lines.push(`\`${p}\` isn't compared with its recorded results here: ${own}.`, '');
  }
  const rows = [
    ...s.scenario.benchmarks.map((spec) => {
      const kind = protectedKind(spec);
      return row(spec.metric, kind, `**${kind.label}**${spec.note ? ` - ${spec.note}` : ''}`);
    }),
    ...keys.filter((k) => !isDetail(k) && !protectedKeys.includes(k)).map((k) => row(k, metricKind(k), metricKind(k).label)),
  ];
  lines.push(table(header, rows), '');
  const details = keys.filter((k) => isDetail(k) && !protectedKeys.includes(k));
  if (details.length) {
    lines.push('<details><summary>Every job and user</summary>', '',
      table(header, details.map((k) => row(k, metricKind(k), metricKind(k).label))), '', '</details>', '');
  }
  return lines.join('\n');
}

/**
 * Runs the benchmark suite (or the given scenarios) for the given policies, writes the
 * comparison report, and records the results if asked to.
 *
 * @param options - the bench options
 * @throws Error - for invalid options, or if any simulation failed
 */
export async function runBench(options: BenchOptions): Promise<void> {
  const suite = loadSuite(options.suiteFile);
  const policies = options.policies ?? suite.policies;
  for (const policy of policies) {
    if (!POLICY_NAMES.includes(policy)) throw new Error(`Unknown policy "${policy}" - available policies: ${POLICY_NAMES.join(', ')}`);
  }
  const seeds = options.seeds ?? suite.seeds;
  const set = { ...suite.set, ...options.sets };
  if (options.record && (options.files.length || options.seeds || Object.keys(options.sets).length)) {
    throw new Error('--record saves results for the whole suite with its own seeds and settings, so it ' +
      "can't be combined with scenario files, --seeds or --set");
  }
  if (options.label !== undefined && !/^[\w.-]+$/.test(options.label)) {
    throw new Error('--label may only contain letters, digits, ".", "_" and "-"');
  }

  const files = options.files.length ? options.files.map((f) => path.resolve(f)) : suite.scenarios;
  const scenarios: BenchScenario[] = files.map((file) => ({ file, scenario: loadScenario(file), hash: scenarioHash(file) }));
  const names = new Set<string>();
  for (const { scenario } of scenarios) {
    if (names.has(scenario.name)) throw new Error(`Two scenarios are named ${scenario.name}`);
    names.add(scenario.name);
    for (const spec of scenario.benchmarks) {
      if (!metricKind(spec.metric)) {
        throw new Error(`${scenario.name}: unknown benchmark metric "${spec.metric}" - use ${metricKeysHelp()}`);
      }
    }
  }

  const harmonyKeys = harmonyEnvKeys();
  const states: Record<string, PolicyState> = Object.fromEntries([...new Set([REFERENCE_POLICY, ...policies])]
    .map((p) => [p, policyState(p, set, harmonyKeys)]));

  // use baseline's recorded results unless something that can change them has changed
  const baselineRecord = readRecord(recordFile(REFERENCE_POLICY));
  const baselineReasons: Record<string, string> = {};
  let baselineNote = 'run with the other policies';
  if (!policies.includes(REFERENCE_POLICY)) {
    let stale: string | null = null;
    if (!baselineRecord) {
      stale = 'there are no recorded results for it';
    } else if (!baselineRecord.code.codeHash || baselineRecord.code.codeHash !== states[REFERENCE_POLICY].codeHash) {
      stale = `Harmony's scheduling code or the simulator has changed since its results were recorded on ${describeCode(baselineRecord.code)}`;
    } else if (settingsProblems(baselineRecord, states[REFERENCE_POLICY]).length) {
      stale = settingsProblems(baselineRecord, states[REFERENCE_POLICY]).join('; ');
    } else if (settingsChanges(baselineRecord, states[REFERENCE_POLICY])) {
      stale = `its settings have changed since its results were recorded (${settingsChanges(baselineRecord, states[REFERENCE_POLICY])})`;
    }
    for (const s of scenarios) {
      const recorded = stale === null ? recordedValues(baselineRecord, s, seeds) : stale;
      if (typeof recorded === 'string') baselineReasons[s.scenario.name] = recorded;
    }
    const afresh = Object.keys(baselineReasons).length;
    const recordedOn = baselineRecord ? `results recorded on ${describeCode(baselineRecord.code)}, ${baselineRecord.code.recordedAt.slice(0, 10)}` : '';
    const reRecord = '`npm run sim -- bench --record --policies baseline` records them again';
    if (stale !== null) {
      baselineNote = `run afresh, because ${stale} - ${reRecord}`;
    } else if (afresh === 0) {
      baselineNote = `${recordedOn} (${path.relative(SIM_ROOT, recordFile(REFERENCE_POLICY))})`;
    } else {
      baselineNote = `${recordedOn}, except for ${afresh} scenario(s) it was run afresh for (see below)`;
    }
    if (baselineRecord && stale === null && baselineRecord.code.node.split('.')[0] !== process.version.split('.')[0]) {
      baselineNote += ` - recorded with Node ${baselineRecord.code.node}, this is ${process.version}`;
    }
  }

  const runList = [
    ...policies.flatMap((policy) => scenarios.map((s) => ({ policy, s }))),
    ...scenarios.filter((s) => baselineReasons[s.scenario.name]).map((s) => ({ policy: REFERENCE_POLICY, s })),
  ];
  const tasks: RunTask[] = runList.flatMap(({ policy, s }) => seeds.map((seed) => {
    const dir = runDir(options.outDir, policy, s.scenario.name, seed);
    fs.rmSync(dir, { recursive: true, force: true });
    return { file: s.file, scenarioName: `${s.scenario.name} seed ${seed}`, policy, runDir: dir, seed: String(seed), sets: set };
  }));
  const failures = await runTasks(tasks, options.parallel);

  const fresh: Record<string, ScenarioValues> = {};
  for (const { policy, s } of runList) {
    fresh[policy] = fresh[policy] || {};
    fresh[policy][s.scenario.name] = freshValues(options.outDir, policy, s.scenario.name, seeds);
  }
  const reference: ScenarioValues = Object.fromEntries(scenarios.map((s) => [
    s.scenario.name, fresh[REFERENCE_POLICY]?.[s.scenario.name] ?? recordedValues(baselineRecord, s, seeds),
  ]));

  const own: Record<string, OwnComparison> = {};
  for (const policy of policies) {
    const record = readRecord(recordFile(policy));
    const reRecord = `\`npm run sim -- bench --record --policies ${policy}\``;
    if (!record) {
      own[policy] = { values: null, note: `no recorded results yet - ${reRecord} saves them` };
      continue;
    }
    const problems = settingsProblems(record, states[policy]);
    if (problems.length) {
      own[policy] = { values: null, note: `not compared, because ${problems.join('; ')}` };
      continue;
    }
    const codeChanged = !record.code.codeHash || record.code.codeHash !== states[policy].codeHash;
    const changedSettings = settingsChanges(record, states[policy]);
    const changes = [
      ...(codeChanged ? ['the code that affects its results'] : []),
      ...(changedSettings ? [`its settings (${changedSettings})`] : []),
    ];
    own[policy] = {
      values: Object.fromEntries(scenarios.map((s) => [s.scenario.name, recordedValues(record, s, seeds)])),
      note: `compared with its results recorded on ${describeCode(record.code)}, ${record.code.recordedAt.slice(0, 10)}` +
        (changes.length
          ? `. Since then ${changes.join(' and ')} changed, so this shows the effect of those changes - ${reRecord} saves the new results`
          : '. Neither the code that affects its results nor its settings have changed, so any difference means the runs weren\'t reproducible'),
    };
  }

  const ctx: ReportContext = {
    options, suite, policies, seeds, set, scenarios, reference, baselineNote, baselineReasons, fresh, own,
  };
  fs.mkdirSync(options.outDir, { recursive: true });
  const reportFile = path.join(options.outDir, 'bench.md');
  fs.writeFileSync(reportFile, [renderHeader(ctx), renderProtected(ctx), ...scenarios.map((s) => renderScenario(ctx, s))].join('\n\n'));
  console.log(`\n${renderProtected(ctx)}\n`);
  console.log(`baseline: ${baselineNote}`);
  for (const policy of policies) console.log(`${policy} vs recorded: ${own[policy].note}`);
  console.log(`\nReport: ${reportFile}`);

  if (failures.length) throw new Error(`${failures.length} simulation(s) failed${options.record || options.label ? ', so nothing was recorded' : ''}`);
  if (options.record) {
    for (const policy of policies) {
      const file = recordFile(policy);
      writeRecord(file, buildRecord(policy, states[policy], seeds, scenarios, fresh[policy]));
      console.log(`Recorded: ${path.relative(process.cwd(), file)}`);
    }
  }
  if (options.label) {
    const dir = path.join(EXPERIMENTS_DIR, `${new Date().toISOString().slice(0, 10)}-${options.label}`);
    for (const policy of policies) {
      const file = path.join(dir, `${policy}.json`);
      writeRecord(file, buildRecord(policy, states[policy], seeds, scenarios, fresh[policy], options.label));
      console.log(`Experiment log: ${path.relative(process.cwd(), file)}`);
    }
  }
}
