import * as fs from 'fs';
import * as path from 'path';

import { RunTask, runTasks, SIM_ROOT, writeComparison } from './batch';
import { configureDatabaseFile, configureEnvironment, installVirtualClock } from './bootstrap';
import { NATIVE_POLICY, POLICY_NAMES } from './policies/catalog';
import { provenanceFor } from './provenance';
import { loadScenario, ResolvedScenario } from './scenario';

const USAGE = `Usage:
  npm run sim -- run <scenario.yml> [--policy <name>] [--out <dir>] [--seed <n>]
                     [--set KEY=VALUE ...] [--log-level <level>] [--quiet]
  npm run sim -- compare <scenario.yml> [<scenario.yml> ...] [--policies <a,b,...>] [--out <dir>]
                     [--seed <n>] [--set KEY=VALUE ...] [--parallel <n>]
  npm run sim -- findings <scenario.yml> [<scenario.yml> ...] [--policies <a,b,...>] [--out <dir>]
                     [--seeds <n,n,...>] [--references <REF=POLICY[@file;file],...>]
                     [--set KEY=VALUE ...] [--parallel <n>]
  npm run sim -- bench [<scenario.yml> ...] [--policies <a,b,...>] [--seeds <n,n,...>]
                     [--record] [--label <name>] [--suite <suite.yml>] [--out <dir>]
                     [--set KEY=VALUE ...] [--parallel <n>]
  npm run sim -- policies

  run      simulate one scenario under one fair queueing policy (default: the scenario's policy,
           or "baseline") and write a report plus raw data to the output directory
           (default: output/<scenario>/<policy>). --policy native installs no policy and runs
           whatever scheduling code the checked out Harmony has built in
  compare  run each scenario under each policy (default: all policies), each in its own
           process, and write comparison.md and comparison.html to the output directory
           (default: output)
  findings run the comparison plus everything needed to back up conclusions about it (other
           seeds, each policy feature switched off in turn, validation checks) and write
           findings.md to the output directory (default: output/findings), keeping any
           conclusions already written there
  bench    run the benchmark suite (benchmarks/suite.yml, or just the given scenarios) for the
           given policies (default: the suite's) and write bench.md to the output directory
           (default: output/bench), comparing each policy with baseline's recorded results and
           with its own. --record saves the results to benchmarks/results/<policy>.json;
           --label saves them to benchmarks/experiments/<date>-<label>/
  policies list the available policies

  --seed <n>      use this seed instead of the scenario's, e.g. to check whether a difference
                  between policies holds up across different random draws
  --set KEY=VALUE overrides an environment variable from the scenario, e.g.
                  --set QUEUE_LONG_POLLING_WAIT_TIME_SEC=3
`;

interface Args {
  command: string;
  files: string[];
  options: Record<string, string>;
  sets: Record<string, string>;
  quiet: boolean;
  record: boolean;
}

/**
 * Parses the command line arguments.
 *
 * @param argv - the arguments after the script name
 * @returns the parsed arguments
 * @throws Error - for unknown or incomplete options
 */
function parseArgs(argv: string[]): Args {
  const args: Args = { command: argv[0], files: [], options: {}, sets: {}, quiet: false, record: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quiet') {
      args.quiet = true;
    } else if (arg === '--record') {
      args.record = true;
    } else if (arg === '--set') {
      const [key, ...rest] = (argv[++i] || '').split('=');
      if (!key || rest.length === 0) throw new Error('--set needs KEY=VALUE');
      args.sets[key] = rest.join('=');
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      args.options[arg.slice(2)] = value;
    } else {
      args.files.push(arg);
    }
  }
  return args;
}

/**
 * Loads a scenario and applies command line overrides.
 *
 * @param file - the scenario file
 * @param args - the parsed arguments (for --seed and --set)
 * @returns the scenario
 * @throws Error - if --seed isn't an integer
 */
function scenarioWithOverrides(file: string, args: Args): ResolvedScenario {
  let seed: number;
  if (args.options.seed !== undefined) {
    seed = Number(args.options.seed);
    if (!Number.isInteger(seed)) throw new Error('--seed needs an integer');
  }
  const scenario = loadScenario(file, seed);
  scenario.env = { ...scenario.env, ...args.sets };
  return scenario;
}

/**
 * Runs one simulation in this process.
 *
 * @param args - the parsed arguments
 */
async function runCommand(args: Args): Promise<void> {
  if (args.files.length !== 1) throw new Error('run takes exactly one scenario file');
  const scenario = scenarioWithOverrides(args.files[0], args);
  const policy = args.options.policy || scenario.policy;
  if (!POLICY_NAMES.includes(policy) && policy !== NATIVE_POLICY) {
    throw new Error(`Unknown policy "${policy}" - available policies: ${POLICY_NAMES.join(', ')}`);
  }
  const runDir = path.resolve(args.options.out || path.join(SIM_ROOT, 'output', scenario.name, policy));
  fs.mkdirSync(runDir, { recursive: true });
  const log = (message: string): void => {
    if (!args.quiet) console.log(message);
  };
  // before the virtual clock replaces Date
  const provenance = provenanceFor(args.files[0], scenario.seed, policy, scenario.env);

  // order matters - see bootstrap.ts
  configureEnvironment(scenario);
  configureDatabaseFile(runDir);
  const clock = installVirtualClock();
  const { simulate } = await import('./simulation');
  const { summarize } = await import('./metrics');
  const { writeRunOutputs } = await import('./report');

  log(`Simulating ${scenario.name} with policy ${policy} (${scenario.jobs.length} jobs)`);
  const result = await simulate({
    scenario, policy, runDir, clock, logLevel: args.options['log-level'] || 'warn', progress: log,
  });
  const summary = summarize(result);
  summary.provenance = provenance;
  writeRunOutputs(runDir, result, summary);
  log(`Done: ${summary.completed ? 'all jobs finished' : 'time limit reached'} after ` +
    `${(summary.endMs / 3_600_000).toFixed(2)} simulated hours in ${(summary.wallMs / 1000).toFixed(1)}s ` +
    `(${Math.round(summary.speedup)}x real time)`);
  log(`Report: ${path.join(runDir, 'report.md')}`);
}

/**
 * Runs every scenario under every policy and writes a comparison report.
 *
 * @param args - the parsed arguments
 */
async function compareCommand(args: Args): Promise<void> {
  if (args.files.length === 0) throw new Error('compare needs at least one scenario file');
  const policies = args.options.policies ? args.options.policies.split(',') : POLICY_NAMES;
  for (const policy of policies) {
    if (!POLICY_NAMES.includes(policy)) throw new Error(`Unknown policy "${policy}"`);
  }
  const outDir = path.resolve(args.options.out || path.join(SIM_ROOT, 'output'));
  const scenarios = args.files.map((file) => ({ file: path.resolve(file), scenario: scenarioWithOverrides(file, args) }));
  const tasks: RunTask[] = scenarios.flatMap(({ file, scenario }) => policies.map((policy) => ({
    file, scenarioName: scenario.name, policy, runDir: path.join(outDir, scenario.name, policy),
    seed: args.options.seed, sets: args.sets,
  })));

  const failures = await runTasks(tasks, args.options.parallel ? parseInt(args.options.parallel, 10) : undefined);
  const { md, html } = await writeComparison(outDir, scenarios.map((s) => s.scenario.name), policies);
  console.log(`Comparison: ${md}`);
  console.log(`            ${html}`);
  if (failures.length) throw new Error(`${failures.length} simulation(s) failed`);
}

/**
 * The command being run, as it can be pasted into a shell to run it again.
 *
 * @returns the command line
 */
function commandLine(): string {
  const quote = (arg: string): string => (/^[\w./=,:@+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, '\'\\\'\'')}'`);
  return `npm run sim -- ${process.argv.slice(2).map(quote).join(' ')}`;
}

/**
 * Runs everything behind findings.md and writes it.
 *
 * @param args - the parsed arguments
 */
async function findingsCommand(args: Args): Promise<void> {
  if (args.files.length === 0) throw new Error('findings needs at least one scenario file');
  const policies = args.options.policies ? args.options.policies.split(',') : POLICY_NAMES;
  for (const policy of policies) {
    if (!POLICY_NAMES.includes(policy)) throw new Error(`Unknown policy "${policy}"`);
  }
  const list = (value: string): string[] => (value ? value.split(',').map((v) => v.trim()).filter((v) => v) : []);
  const { runFindings } = await import('./findings');
  await runFindings({
    files: args.files,
    policies,
    outDir: path.resolve(args.options.out || path.join(SIM_ROOT, 'output', 'findings')),
    seeds: list(args.options.seeds),
    references: list(args.options.references),
    sets: args.sets,
    parallel: args.options.parallel ? parseInt(args.options.parallel, 10) : undefined,
    command: commandLine(),
  });
}

/**
 * Runs the benchmark suite and compares the results with the recorded ones.
 *
 * @param args - the parsed arguments
 * @throws Error - if --seeds isn't a list of integers
 */
async function benchCommand(args: Args): Promise<void> {
  let seeds: number[];
  if (args.options.seeds !== undefined) {
    seeds = args.options.seeds.split(',').map((s) => Number(s.trim()));
    if (!seeds.every(Number.isInteger)) throw new Error('--seeds needs a list of integers');
  }
  const { DEFAULT_SUITE, runBench } = await import('./bench');
  await runBench({
    suiteFile: path.resolve(args.options.suite || DEFAULT_SUITE),
    files: args.files,
    policies: args.options.policies ? args.options.policies.split(',').map((p) => p.trim()) : undefined,
    seeds,
    sets: args.sets,
    record: args.record,
    label: args.options.label,
    outDir: path.resolve(args.options.out || path.join(SIM_ROOT, 'output', 'bench')),
    parallel: args.options.parallel ? parseInt(args.options.parallel, 10) : undefined,
    command: commandLine(),
  });
}

/**
 * Entry point.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'run':
      await runCommand(args);
      break;
    case 'compare':
      await compareCommand(args);
      break;
    case 'findings':
      await findingsCommand(args);
      break;
    case 'bench':
      await benchCommand(args);
      break;
    case 'policies':
      console.log(POLICY_NAMES.join('\n'));
      break;
    default:
      console.log(USAGE);
      process.exitCode = args.command ? 1 : 0;
  }
}

main().then(() => {
  // Harmony's modules leave handles open (log files, caches, the k8s client), so exit explicitly
  // eslint-disable-next-line n/no-process-exit
  process.exit(process.exitCode ?? 0);
}).catch((e) => {
  console.error(e.stack || e.message);
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
});
