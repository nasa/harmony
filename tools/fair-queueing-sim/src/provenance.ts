import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { REPO_ROOT } from './bootstrap';
import { resolvedSettings } from './policies/catalog';

//
// Provenance: enough about a run to know exactly what produced it - the commit, whether (and
// how) the files that can affect results differed from it, the seed, the policy and all of its
// settings. Recorded in every summary.json and shown in the reports, so results can be
// interpreted (and reproduced) without knowing how they were made.
//

// the paths whose contents can change simulation results
const RESULT_PATHS = [
  'services/harmony/app', 'services/harmony/env-defaults',
  'services/work-scheduler/app', 'services/work-scheduler/env-defaults',
  'services/work-updater/app', 'services/work-updater/env-defaults',
  'packages/util', 'db', 'tools/fair-queueing-sim/src',
];

export interface GitState {
  commit: string | null;
  branch: string | null;
  // true if any file that can affect results differs from the commit (null if not a git checkout)
  dirty: boolean | null;
  changedFiles: string[];
  // short hash of those differences, so runs from the same uncommitted state can be recognized
  changesHash: string | null;
}

export interface Provenance extends GitState {
  scenarioFile: string;
  seed: number;
  policy: string;
  // the value of every setting the policy reads, including defaults
  policySettings: Record<string, string>;
  // environment overrides from the scenario and --set
  envOverrides: Record<string, string>;
  node: string;
  // when the run happened (real time)
  ranAt: string;
}

/**
 * Runs git in the repo, returning its output or null if it fails (e.g. not a git checkout).
 *
 * @param args - git arguments
 * @returns the output, or null
 */
function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * Describes the git state of the files that can affect simulation results.
 *
 * @returns the git state
 */
export function gitState(): GitState {
  const commit = git('rev-parse', 'HEAD')?.trim() ?? null;
  if (!commit) {
    return { commit: null, branch: null, dirty: null, changedFiles: [], changesHash: null };
  }
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')?.trim() ?? null;
  const modified = (git('diff', '--name-only', 'HEAD', '--', ...RESULT_PATHS) || '').split('\n').filter((f) => f);
  const untracked = (git('ls-files', '--others', '--exclude-standard', '--', ...RESULT_PATHS) || '')
    .split('\n').filter((f) => f);
  const changedFiles = [...new Set([...modified, ...untracked])].sort();
  let changesHash: string = null;
  if (changedFiles.length > 0) {
    const hash = createHash('sha256');
    hash.update(git('diff', 'HEAD', '--', ...RESULT_PATHS) || '');
    for (const file of untracked.sort()) {
      hash.update(file);
      hash.update(fs.readFileSync(path.join(REPO_ROOT, file)));
    }
    changesHash = hash.digest('hex').slice(0, 12);
  }
  return { commit, branch, dirty: changedFiles.length > 0, changedFiles, changesHash };
}

/**
 * Builds the provenance for a run. Call this before the virtual clock is installed, so the run
 * time is real.
 *
 * @param scenarioFile - the scenario file
 * @param seed - the seed used
 * @param policy - the policy
 * @param envOverrides - environment overrides from the scenario and --set
 * @returns the provenance
 */
export function provenanceFor(
  scenarioFile: string, seed: number, policy: string, envOverrides: Record<string, string>,
): Provenance {
  return {
    ...gitState(),
    scenarioFile: path.relative(REPO_ROOT, path.resolve(scenarioFile)),
    seed,
    policy,
    policySettings: resolvedSettings(policy, { ...process.env, ...envOverrides } as Record<string, string>),
    envOverrides,
    node: process.version,
    ranAt: new Date().toISOString(),
  };
}

/**
 * A one line description of the code a run used, e.g. "ef1b9aa9c (fair-queueing-sim) + uncommitted changes 3f2a1b".
 *
 * @param p - the git state
 * @returns the description
 */
export function describeCode(p: GitState): string {
  if (!p?.commit) return 'unknown (not a git checkout)';
  const base = `${p.commit.slice(0, 9)}${p.branch ? ` (${p.branch})` : ''}`;
  return p.dirty ? `${base} + uncommitted changes ${p.changesHash} to ${p.changedFiles.length} file(s)` : base;
}
