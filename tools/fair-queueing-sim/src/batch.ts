import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Summary } from './metrics';
import type { ComparedRun } from './report-html';

export const SIM_ROOT = path.resolve(__dirname, '..');

export interface RunTask {
  // scenario file, and its name (for logging)
  file: string;
  scenarioName: string;
  policy: string;
  runDir: string;
  seed?: string;
  sets: Record<string, string>;
  // directory containing the simulator to run (default: this one) - used to run the simulator
  // against another checkout of Harmony
  simRoot?: string;
}

/**
 * Runs one simulation in a child process.
 *
 * @param task - the simulation to run
 * @returns resolves when the child exits successfully
 */
export function runChild(task: RunTask): Promise<void> {
  const simRoot = task.simRoot || SIM_ROOT;
  const childArgs = [
    '-r', require.resolve('ts-node/register/transpile-only'), path.join(simRoot, 'src', 'cli.ts'),
    'run', task.file, '--policy', task.policy, '--out', task.runDir, '--quiet',
    ...(task.seed !== undefined ? ['--seed', task.seed] : []),
    ...Object.entries(task.sets).flatMap(([k, v]) => ['--set', `${k}=${v}`]),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'inherit', 'inherit'], cwd: simRoot });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0
      ? resolve()
      : reject(new Error(`${path.basename(task.file)} / ${task.policy} exited with ${code}`))));
  });
}

/**
 * Runs simulations, several at a time.
 *
 * @param tasks - the simulations to run
 * @param parallel - how many to run at once (default: CPU count - 1)
 * @returns a message for each simulation that failed
 */
export async function runTasks(tasks: RunTask[], parallel?: number): Promise<string[]> {
  const n = Math.max(1, parallel || Math.max(1, os.cpus().length - 1));
  console.log(`Running ${tasks.length} simulations, ${n} at a time`);
  const queue = [...tasks];
  const failures: string[] = [];
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      const start = Date.now();
      try {
        await runChild(task);
        console.log(`  ${task.scenarioName} / ${task.policy}: ${((Date.now() - start) / 1000).toFixed(1)}s`);
      } catch (e) {
        failures.push(e.message);
        console.error(`  ${task.scenarioName} / ${task.policy}: FAILED (${e.message})`);
      }
    }
  }));
  return failures;
}

/**
 * Reads a run's summary and samples from its output directory.
 *
 * @param runDir - the run's output directory
 * @returns the run, or null if it has no summary
 */
export function readRun(runDir: string): ComparedRun | null {
  if (!fs.existsSync(path.join(runDir, 'summary.json'))) return null;
  return {
    summary: JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')) as Summary,
    samples: fs.readFileSync(path.join(runDir, 'samples.ndjson'), 'utf8')
      .split('\n').filter((line) => line).map((line) => JSON.parse(line)),
  };
}

/**
 * Writes comparison.md and comparison.html for runs in `<outDir>/<scenario>/<policy>`.
 *
 * @param outDir - the output directory
 * @param scenarioNames - the scenarios, in order
 * @param policies - the policies, in order
 * @returns the paths of the files written
 */
export async function writeComparison(
  outDir: string, scenarioNames: string[], policies: string[],
): Promise<{ md: string; html: string }> {
  const { renderComparison, renderComparisonHeader } = await import('./report');
  const { renderComparisonHtml } = await import('./report-html');
  const sections = [renderComparisonHeader(policies)];
  const htmlScenarios: ComparedRun[][] = [];
  for (const name of scenarioNames) {
    const runs = policies.map((policy) => readRun(path.join(outDir, name, policy))).filter((r) => r);
    if (runs.length === 0) continue;
    sections.push(renderComparison(runs.map((r) => r.summary)));
    htmlScenarios.push(runs);
  }
  const md = path.join(outDir, 'comparison.md');
  fs.writeFileSync(md, sections.join('\n'));
  const html = path.join(outDir, 'comparison.html');
  fs.writeFileSync(html, renderComparisonHtml(htmlScenarios, policies));
  return { md, html };
}
