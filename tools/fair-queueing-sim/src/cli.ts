import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { configureDatabaseFile, configureEnvironment, installVirtualClock } from './bootstrap';
import { POLICY_NAMES } from './policies/names';
import { loadScenario, ResolvedScenario } from './scenario';

const USAGE = `Usage:
  npm run sim -- run <scenario.yml> [--policy <name>] [--out <dir>] [--seed <n>]
                     [--set KEY=VALUE ...] [--log-level <level>] [--quiet]
  npm run sim -- compare <scenario.yml> [<scenario.yml> ...] [--policies <a,b,...>] [--out <dir>]
                     [--seed <n>] [--set KEY=VALUE ...] [--parallel <n>]
  npm run sim -- policies

  run      simulate one scenario under one fair queueing policy (default: the scenario's policy,
           or "baseline") and write a report plus raw data to the output directory
           (default: output/<scenario>/<policy>)
  compare  run each scenario under each policy (default: all policies), each in its own
           process, and write comparison.md and comparison.html to the output directory
           (default: output)
  policies list the available policies

  --seed <n>      use this seed instead of the scenario's, e.g. to check whether a difference
                  between policies holds up across different random draws
  --set KEY=VALUE overrides an environment variable from the scenario, e.g.
                  --set QUEUE_LONG_POLLING_WAIT_TIME_SEC=3
`;

const SIM_ROOT = path.resolve(__dirname, '..');

interface Args {
  command: string;
  files: string[];
  options: Record<string, string>;
  sets: Record<string, string>;
  quiet: boolean;
}

/**
 * Parses the command line arguments.
 *
 * @param argv - the arguments after the script name
 * @returns the parsed arguments
 * @throws Error - for unknown or incomplete options
 */
function parseArgs(argv: string[]): Args {
  const args: Args = { command: argv[0], files: [], options: {}, sets: {}, quiet: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quiet') {
      args.quiet = true;
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
  if (!POLICY_NAMES.includes(policy)) {
    throw new Error(`Unknown policy "${policy}" - available policies: ${POLICY_NAMES.join(', ')}`);
  }
  const runDir = path.resolve(args.options.out || path.join(SIM_ROOT, 'output', scenario.name, policy));
  fs.mkdirSync(runDir, { recursive: true });
  const log = (message: string): void => {
    if (!args.quiet) console.log(message);
  };

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
  writeRunOutputs(runDir, result, summary);
  log(`Done: ${summary.completed ? 'all jobs finished' : 'time limit reached'} after ` +
    `${(summary.endMs / 3_600_000).toFixed(2)} simulated hours in ${(summary.wallMs / 1000).toFixed(1)}s ` +
    `(${Math.round(summary.speedup)}x real time)`);
  log(`Report: ${path.join(runDir, 'report.md')}`);
}

/**
 * Runs one simulation in a child process.
 *
 * @param file - the scenario file
 * @param policy - the policy
 * @param runDir - the output directory for the run
 * @param args - the parsed arguments (for --seed and --set)
 * @returns resolves when the child exits successfully
 */
function runChild(file: string, policy: string, runDir: string, args: Args): Promise<void> {
  const childArgs = [
    '-r', require.resolve('ts-node/register/transpile-only'), __filename,
    'run', file, '--policy', policy, '--out', runDir, '--quiet',
    ...(args.options.seed !== undefined ? ['--seed', args.options.seed] : []),
    ...Object.entries(args.sets).flatMap(([k, v]) => ['--set', `${k}=${v}`]),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'inherit', 'inherit'], cwd: SIM_ROOT });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(file)} / ${policy} exited with ${code}`))));
  });
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
  const tasks = scenarios.flatMap(({ file, scenario }) => policies.map((policy) => ({
    file, scenario, policy, runDir: path.join(outDir, scenario.name, policy),
  })));

  const parallel = Math.max(1, parseInt(args.options.parallel || String(Math.max(1, os.cpus().length - 1)), 10));
  console.log(`Running ${tasks.length} simulations, ${parallel} at a time`);
  const queue = [...tasks];
  const failures: string[] = [];
  await Promise.all(Array.from({ length: Math.min(parallel, tasks.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      const start = Date.now();
      try {
        await runChild(task.file, task.policy, task.runDir, args);
        console.log(`  ${task.scenario.name} / ${task.policy}: ${((Date.now() - start) / 1000).toFixed(1)}s`);
      } catch (e) {
        failures.push(e.message);
        console.error(`  ${task.scenario.name} / ${task.policy}: FAILED (${e.message})`);
      }
    }
  }));

  const { renderComparison } = await import('./report');
  const { renderComparisonHtml } = await import('./report-html');
  const sections = [
    '# Fair queueing policy comparison', '',
    `Policies: ${policies.map((p) => `\`${p}\``).join(', ')}`, '',
  ];
  const htmlScenarios = [];
  for (const { scenario } of scenarios) {
    const runDirs = policies
      .map((policy) => path.join(outDir, scenario.name, policy))
      .filter((dir) => fs.existsSync(path.join(dir, 'summary.json')));
    if (runDirs.length === 0) continue;
    const runs = runDirs.map((dir) => ({
      summary: JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')),
      samples: fs.readFileSync(path.join(dir, 'samples.ndjson'), 'utf8')
        .split('\n').filter((line) => line).map((line) => JSON.parse(line)),
    }));
    sections.push(renderComparison(runs.map((r) => r.summary)));
    htmlScenarios.push(runs);
  }
  const comparisonFile = path.join(outDir, 'comparison.md');
  fs.writeFileSync(comparisonFile, sections.join('\n'));
  const htmlFile = path.join(outDir, 'comparison.html');
  fs.writeFileSync(htmlFile, renderComparisonHtml(htmlScenarios));
  console.log(`Comparison: ${comparisonFile}`);
  console.log(`            ${htmlFile}`);
  if (failures.length) throw new Error(`${failures.length} simulation(s) failed`);
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
