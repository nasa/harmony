import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readRun, RunTask, runTasks, SIM_ROOT, writeComparison } from './batch';
import { REPO_ROOT } from './bootstrap';
import type { Summary } from './metrics';
import { NATIVE_POLICY, POLICY_CATALOG } from './policies/catalog';
import { describeCode, GitState, gitState } from './provenance';
import { comparisonTables, designNotes, renderGlossary } from './report';
import { formatDuration, loadScenario, ResolvedScenario } from './scenario';

//
// The `findings` command: runs everything needed to support conclusions about the policies -
// the comparison itself, optionally the same comparison with other seeds, a run of each policy
// variant (one feature switched off at a time), and validation checks - then writes
// findings.md. Everything in findings.md except its Conclusions section is regenerated each
// time; the Conclusions are written by a person (or Claude Code) and preserved, with a warning
// whenever the evidence was regenerated from different code than the conclusions were written
// for.
//

const LOG_FILES = ['decisions.ndjson', 'runs.ndjson', 'work-items.ndjson'];

// the files a reference checkout needs for the simulator to run against it
const REFERENCE_PATHS = [
  'services/harmony/app', 'services/harmony/env-defaults', 'services/harmony/package.json',
  'services/harmony/test/resources/data-operation-samples/valid-operation-input.json',
  'services/work-scheduler/app', 'services/work-scheduler/env-defaults', 'services/work-scheduler/package.json',
  'services/work-updater/app', 'services/work-updater/env-defaults', 'services/work-updater/package.json',
  'packages/util', 'db', 'tsconfig.base.json',
];
const NODE_MODULES_DIRS = ['services/harmony', 'services/work-scheduler', 'services/work-updater', 'packages/util'];

export interface FindingsOptions {
  files: string[];
  policies: string[];
  outDir: string;
  seeds: string[];
  // "REF=POLICY" or "REF=POLICY@file;file" - check that POLICY here makes exactly the same
  // decisions as REF's own scheduling code, optionally overlaying working tree files on REF
  references: string[];
  sets: Record<string, string>;
  parallel?: number;
  command: string;
}

interface Reference {
  spec: string;
  ref: string;
  policy: string;
  overlays: string[];
  commit?: string;
  dir?: string;
  error?: string;
}

interface CheckResult {
  name: string;
  description: string;
  // per scenario: true if the logs were identical, or a reason the check couldn't be done
  results: Record<string, boolean | string>;
}

/**
 * Returns true if two runs produced identical decision, run and work item logs.
 *
 * @param dirA - one run's output directory
 * @param dirB - the other's
 * @returns true if identical, or a description of why they couldn't be compared
 */
function sameLogs(dirA: string, dirB: string): boolean | string {
  for (const file of LOG_FILES) {
    const a = path.join(dirA, file);
    const b = path.join(dirB, file);
    if (!fs.existsSync(a) || !fs.existsSync(b)) return 'run missing (it failed - see the console output)';
    if (!fs.readFileSync(a).equals(fs.readFileSync(b))) return false;
  }
  return true;
}

/**
 * Parses a reference spec.
 *
 * @param spec - "REF=POLICY" or "REF=POLICY\@file;file"
 * @returns the reference
 * @throws Error - if the spec is malformed
 */
function parseReference(spec: string): Reference {
  const match = /^([^=]+)=([^@]+)(?:@(.+))?$/.exec(spec);
  if (!match) throw new Error(`Invalid reference "${spec}" - use REF=POLICY or REF=POLICY@file;file`);
  return { spec, ref: match[1], policy: match[2], overlays: match[3] ? match[3].split(';') : [] };
}

/**
 * Extracts a git ref's version of the code the simulator needs into a temporary directory, with
 * this checkout's node_modules and simulator, so the simulator can run that ref's own scheduling
 * code (with the "native" policy).
 *
 * @param reference - the reference to prepare
 */
function prepareReference(reference: Reference): void {
  try {
    reference.commit = execFileSync('git', ['rev-parse', `${reference.ref}^{commit}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    reference.error = `git ref ${reference.ref} not found`;
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `fq-sim-ref-${reference.commit.slice(0, 9)}-`));
  const paths = REFERENCE_PATHS.filter((p) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${reference.commit}:${p}`], { cwd: REPO_ROOT, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
  execFileSync('sh', ['-c', `git archive ${reference.commit} ${paths.join(' ')} | tar -x -C "${dir}"`], { cwd: REPO_ROOT });
  for (const d of NODE_MODULES_DIRS) {
    if (fs.existsSync(path.join(dir, d)) && fs.existsSync(path.join(REPO_ROOT, d, 'node_modules'))) {
      fs.symlinkSync(path.join(REPO_ROOT, d, 'node_modules'), path.join(dir, d, 'node_modules'));
    }
  }
  const sim = path.join(dir, 'tools', 'fair-queueing-sim');
  fs.mkdirSync(sim, { recursive: true });
  fs.cpSync(path.join(SIM_ROOT, 'src'), path.join(sim, 'src'), { recursive: true });
  for (const f of ['package.json', 'tsconfig.json']) fs.copyFileSync(path.join(SIM_ROOT, f), path.join(sim, f));
  fs.symlinkSync(path.join(SIM_ROOT, 'node_modules'), path.join(sim, 'node_modules'));
  for (const overlay of reference.overlays) {
    fs.mkdirSync(path.dirname(path.join(dir, overlay)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, overlay), path.join(dir, overlay));
  }
  reference.dir = dir;
}

interface MetricDef {
  label: string;
  better: 'lower' | 'higher';
  value: (s: Summary) => number | null;
  format: (n: number) => string;
}

const METRICS: MetricDef[] = [
  { label: 'mean job slowdown', better: 'lower', value: (s) => s.overall.meanSlowdown, format: (n) => n.toFixed(2) },
  { label: 'sync makespan (max)', better: 'lower', value: (s) => s.sync.maxMakespanMs, format: formatDuration },
  {
    label: 'contended fairness (mean over services)',
    better: 'higher',
    value: (s): number | null => {
      const values = s.services.map((svc) => svc.contendedFairness).filter((v) => v !== null);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    },
    format: (n) => n.toFixed(2),
  },
  {
    label: 'idle while work ready (pod-h)',
    better: 'lower',
    value: (s) => s.services.reduce((sum, svc) => sum + svc.idleWhileReadyPodMs, 0) / 3_600_000,
    format: (n) => n.toFixed(1),
  },
];

/**
 * A short cell summarizing a run: slowdown / fairness / idle / sync.
 *
 * @param s - the run's summary, or null if it's missing
 * @returns the cell text
 */
function shortCell(s: Summary | null): string {
  if (!s) return 'missing';
  return METRICS.map((m) => {
    const v = m.value(s);
    return v === null || v === undefined ? '-' : m.format(v);
  }).join(' / ');
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

const CONCLUSIONS_MARKER = /<!-- conclusions written for code: (.*?) -->/;

/**
 * An identifier for exact code state, used to tell whether conclusions are current.
 *
 * @param g - the git state
 * @returns the identifier
 */
function codeId(g: GitState): string {
  return g.commit ? `${g.commit}${g.dirty ? `+${g.changesHash}` : ''}` : 'unknown';
}

/**
 * Builds the Conclusions section, keeping any existing conclusions and flagging them if they
 * were written for different code.
 *
 * @param findingsFile - the findings.md path
 * @param git - the current code
 * @param command - the command used to regenerate findings
 * @returns the section
 */
function conclusionsSection(findingsFile: string, git: GitState, command: string): string {
  const current = codeId(git);
  let existing = '';
  if (fs.existsSync(findingsFile)) {
    const match = /\n## Conclusions\n([\s\S]*?)(?=\n## )/.exec(fs.readFileSync(findingsFile, 'utf8'));
    existing = match ? match[1].trim() : '';
  }
  const out = ['## Conclusions', ''];
  const written = CONCLUSIONS_MARKER.exec(existing);
  const body = existing
    .replace(CONCLUSIONS_MARKER, '')
    .replace(/^> \*\*These conclusions were written for different code[\s\S]*?\n\n/m, '')
    .trim();
  if (!body || body.startsWith('_Not written yet._')) {
    const relative = path.relative(REPO_ROOT, findingsFile);
    const shown = relative.startsWith('..') ? findingsFile : relative;
    out.push(`<!-- conclusions written for code: ${current} -->`, '');
    out.push(
      `_Not written yet._ Ask Claude Code something like: "Read ${shown} and write its Conclusions section: for each scenario, ` +
      'which policy did best against the scenario\'s stated good result and why, what each policy feature ' +
      'contributes, which differences held up across seeds, and what you would recommend. Keep the marker comment."',
    );
    return out.join('\n');
  }
  const writtenFor = written ? written[1] : 'unknown';
  out.push(`<!-- conclusions written for code: ${writtenFor} -->`, '');
  if (writtenFor !== current) {
    out.push(
      `> **These conclusions were written for different code (${writtenFor}) than the evidence below ` +
      `(${current}).** Review them against the regenerated results, update them, then change the marker ` +
      `comment above to \`${current}\`. (Regenerated with: \`${command}\`)`, '',
    );
  }
  out.push(body);
  return out.join('\n');
}

/**
 * Runs the findings command.
 *
 * @param o - the options
 */
export async function runFindings(o: FindingsOptions): Promise<void> {
  const git = gitState();
  const scenarios: { file: string; scenario: ResolvedScenario }[] = o.files.map((file) => ({
    file: path.resolve(file), scenario: loadScenario(file),
  }));
  const names = scenarios.map((s) => s.scenario.name);
  const dir = (...parts: string[]): string => path.join(o.outDir, ...parts);
  const tasks: RunTask[] = [];
  const add = (file: string, scenarioName: string, policy: string, runDir: string,
    extra: Partial<RunTask> = {}): void => {
    tasks.push({ file, scenarioName, policy, runDir, sets: { ...o.sets, ...(extra.sets || {}) }, seed: extra.seed, simRoot: extra.simRoot });
  };

  // the comparison itself, and again with each extra seed
  for (const { file, scenario } of scenarios) {
    for (const policy of o.policies) add(file, scenario.name, policy, dir('main', scenario.name, policy));
    for (const seed of o.seeds) {
      for (const policy of o.policies) add(file, scenario.name, policy, dir('seeds', `seed-${seed}`, scenario.name, policy), { seed });
    }
  }

  // each policy variant, and each equivalence check
  const variantPolicies = o.policies.filter((p) => POLICY_CATALOG[p]?.variants?.length);
  const equivalences = o.policies.filter((p) => POLICY_CATALOG[p]?.equivalentTo);
  for (const { file, scenario } of scenarios) {
    for (const policy of variantPolicies) {
      for (const variant of POLICY_CATALOG[policy].variants) {
        add(file, scenario.name, policy, dir('variants', policy, variant.name, scenario.name), { sets: variant.set });
      }
    }
    for (const policy of equivalences) {
      const eq = POLICY_CATALOG[policy].equivalentTo;
      add(file, scenario.name, policy, dir('checks', 'equivalent', policy, scenario.name), { sets: eq.set });
      if (!o.policies.includes(eq.policy)) add(file, scenario.name, eq.policy, dir('main', scenario.name, eq.policy));
    }
    // determinism: the same run twice must be identical
    add(file, scenario.name, o.policies[0], dir('checks', 'determinism', scenario.name));
  }

  // other branches' own code
  const references = o.references.map(parseReference);
  for (const reference of references) {
    prepareReference(reference);
    if (reference.error) continue;
    for (const { file, scenario } of scenarios) {
      add(file, scenario.name, NATIVE_POLICY, dir('checks', 'reference', reference.ref.replace(/[^\w.-]/g, '_'), scenario.name),
        { simRoot: path.join(reference.dir, 'tools', 'fair-queueing-sim') });
      if (!o.policies.includes(reference.policy)) add(file, scenario.name, reference.policy, dir('main', scenario.name, reference.policy));
    }
  }

  const failures = await runTasks(tasks, o.parallel);
  for (const reference of references) {
    if (reference.dir) fs.rmSync(reference.dir, { recursive: true, force: true });
  }
  await writeComparison(dir('main'), names, o.policies);
  for (const seed of o.seeds) await writeComparison(dir('seeds', `seed-${seed}`), names, o.policies);

  // checks
  const checks: CheckResult[] = [];
  checks.push({
    name: 'Determinism',
    description: `${o.policies[0]} run twice from scratch produces identical logs`,
    results: Object.fromEntries(names.map((n) => [n, sameLogs(dir('main', n, o.policies[0]), dir('checks', 'determinism', n))])),
  });
  for (const policy of equivalences) {
    const eq = POLICY_CATALOG[policy].equivalentTo;
    checks.push({
      name: `${policy} = ${eq.policy}`,
      description: `${eq.description} (settings: ${Object.entries(eq.set).map(([k, v]) => `${k}=${v}`).join(', ')})`,
      results: Object.fromEntries(names.map((n) => [n, sameLogs(dir('checks', 'equivalent', policy, n), dir('main', n, eq.policy))])),
    });
  }
  for (const r of references) {
    const refDir = r.ref.replace(/[^\w.-]/g, '_');
    checks.push({
      name: `${r.policy} = ${r.ref}'s own code`,
      description: r.error
        ? `not run: ${r.error}`
        : `${r.policy} here makes exactly the same decisions as the scheduling code built into ${r.ref} ` +
          `(commit ${r.commit.slice(0, 9)})${r.overlays.length ? `, with these files taken from this checkout so it runs under the simulator: ${r.overlays.join(', ')}` : ''}`,
      results: r.error ? {} : Object.fromEntries(names.map((n) => [n, sameLogs(dir('checks', 'reference', refDir, n), dir('main', n, r.policy))])),
    });
  }

  const findingsFile = dir('findings.md');
  const out: string[] = [];
  out.push('# Fair queueing simulator findings', '');
  out.push(`Generated ${new Date().toISOString()} with \`${o.command}\` (from tools/fair-queueing-sim).`, '');
  out.push(`**Code:** ${describeCode(git)}.`, '');
  if (git.dirty) {
    out.push('These results depend on uncommitted changes to: ' + git.changedFiles.map((f) => `\`${f}\``).join(', ') + '.', '');
  }
  if (failures.length) out.push(`**${failures.length} simulation(s) failed** - their results are missing below: ${failures.join('; ')}`, '');
  out.push('Everything below except the Conclusions is regenerated by the command above. The full comparison, with charts, ' +
    'is in `main/comparison.html` next to this file; every run\'s raw data is under `main/`, `seeds/`, `variants/` and `checks/`.', '');

  out.push('### Policies', '');
  for (const p of o.policies) out.push(`- \`${p}\` - ${POLICY_CATALOG[p]?.description ?? ''}`);
  out.push('');
  for (const note of designNotes(o.policies)) out.push(`**Design note:** ${note}`, '');

  out.push('### Scenarios', '');
  out.push(table(['scenario', 'what it tests', 'what a good result looks like'],
    scenarios.map(({ scenario }) => [scenario.name, scenario.description.replace(/\n/g, ' '), scenario.goodOutcome.replace(/\n/g, ' ') || '-'])), '');

  out.push(conclusionsSection(findingsFile, git, o.command), '');

  out.push('## Results', '');
  out.push(renderGlossary(), '');
  for (const name of names) {
    const runs = o.policies.map((p) => readRun(dir('main', name, p))?.summary).filter((s) => s);
    if (!runs.length) continue;
    out.push(`### ${name}`, '');
    const { tables } = comparisonTables(runs);
    for (const t of tables.slice(0, 2)) out.push(`${t.caption}:`, '', table(t.header, t.rows), '');
  }

  if (o.seeds.length) {
    out.push('## Robustness across seeds', '');
    out.push(`Each scenario was also run with seeds ${o.seeds.join(', ')}, which changes the work item durations, arrivals and ` +
      'shuffles. For each metric: the mean over all runs (the scenario\'s own seed plus these), the range, and how often each ' +
      'policy was the best. A difference that holds in every seed is real; one that flips between seeds is noise.', '');
    for (const name of names) {
      const bySeed = [['scenario seed', dir('main')], ...o.seeds.map((s) => [`seed ${s}`, dir('seeds', `seed-${s}`)])]
        .map(([, base]) => o.policies.map((p) => readRun(path.join(base, name, p))?.summary || null));
      const rows: string[][] = [];
      for (const m of METRICS) {
        const values = o.policies.map((_p, pi) => bySeed.map((runs) => (runs[pi] ? m.value(runs[pi]) : null)).filter((v) => v !== null && v !== undefined));
        if (values.every((v) => v.length === 0)) continue;
        const best = o.policies.map(() => 0);
        for (const runs of bySeed) {
          const vals = runs.map((s) => (s ? m.value(s) : null));
          if (vals.some((v) => v === null || v === undefined)) continue;
          const target = m.better === 'lower' ? Math.min(...vals) : Math.max(...vals);
          vals.forEach((v, i) => { if (Math.abs(v - target) < 1e-9) best[i] += 1; });
        }
        rows.push([m.label, ...values.map((v, i) => (v.length
          ? `${m.format(v.reduce((a, b) => a + b, 0) / v.length)} (${m.format(Math.min(...v))}-${m.format(Math.max(...v))}), best ${best[i]}/${bySeed.length}`
          : '-'))]);
      }
      out.push(`### ${name}`, '', table(['metric', ...o.policies], rows), '');
    }
  }

  if (variantPolicies.length) {
    out.push('## What each feature contributes', '');
    out.push('Each column switches off one feature of the policy (all others on). Cells are mean job slowdown / max sync ' +
      'makespan / contended fairness / idle while work ready (pod-h). Compare each column with "all on": where switching a ' +
      'feature off makes a scenario worse, that feature is what helps there; where it makes it better, that feature has a cost there.', '');
    for (const policy of variantPolicies) {
      const { variants } = POLICY_CATALOG[policy];
      const eqPolicy = POLICY_CATALOG[policy].equivalentTo?.policy;
      const header = ['scenario', 'all on', ...variants.map((v) => v.description), ...(eqPolicy ? [eqPolicy] : [])];
      const rows = names.map((n) => [
        n, shortCell(readRun(dir('main', n, policy))?.summary),
        ...variants.map((v) => shortCell(readRun(dir('variants', policy, v.name, n))?.summary)),
        ...(eqPolicy ? [shortCell(readRun(dir('main', n, eqPolicy))?.summary)] : []),
      ]);
      out.push(`### ${policy}`, '', table(header, rows), '');
    }
  }

  out.push('## Validation', '');
  out.push('Checks that the simulator and the policies are doing what they claim. "identical" means the decision log, ' +
    'work item attempts and final work item states were byte for byte the same.', '');
  out.push(table(['check', 'what it shows', ...names], checks.map((c) => [
    c.name, c.description,
    ...names.map((n) => {
      const r = c.results[n];
      if (r === undefined) return '-';
      return r === true ? 'identical' : r === false ? '**DIFFERENT**' : r;
    }),
  ])), '');

  out.push('## Regenerating', '', '```fish', o.command, '```', '');
  out.push('This reruns everything and rewrites this file, keeping the Conclusions (flagged for review if the code changed).', '');

  fs.mkdirSync(o.outDir, { recursive: true });
  fs.writeFileSync(findingsFile, out.join('\n'));
  console.log(`Findings: ${findingsFile}`);
  if (failures.length) throw new Error(`${failures.length} simulation(s) failed`);
}
