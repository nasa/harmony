import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect } from 'chai';
import { after, before, describe, it } from 'mocha';

import { runChild, SIM_ROOT } from '../src/batch';
import type { Summary } from '../src/metrics';
import { POLICY_NAMES } from '../src/policies/catalog';

const SMOKE = path.join(SIM_ROOT, 'scenarios', 'smoke.yml');
// the logs that record every decision and its consequences - identical logs mean identical runs
const LOG_FILES = ['decisions.ndjson', 'runs.ndjson', 'work-items.ndjson'];

//
// Runs scenarios/smoke.yml end to end under every policy, twice each, through the same child
// process runner `compare` and `bench` use (each simulation needs a fresh process, since Harmony
// reads its environment and opens its database when it loads).
//
describe('smoke test', function () {
  this.timeout(180_000);

  const outDir = path.join(os.tmpdir(), `fq-sim-smoke-${process.pid}`);
  before(async function () {
    fs.rmSync(outDir, { recursive: true, force: true });
    await Promise.all(POLICY_NAMES.flatMap((policy) => ['first', 'second'].map((run) => runChild({
      file: SMOKE, scenarioName: 'smoke', policy, runDir: path.join(outDir, policy, run), sets: {},
    }))));
  });

  after(function () {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  for (const policy of POLICY_NAMES) {
    describe(`under ${policy}`, function () {
      const summaryOf = (run: string): Summary => JSON.parse(fs.readFileSync(path.join(outDir, policy, run, 'summary.json'), 'utf8'));

      it('finishes every job successfully', function () {
        const summary = summaryOf('first');
        expect(summary.completed).to.be.true;
        expect(summary.jobs.map((j) => [j.name, j.status])).to.deep.equal([['alice-1', 'successful'], ['bob-sync', 'successful']]);
        expect(summary.sync.jobs).to.equal(1);
      });

      it('records the policy it ran', function () {
        expect(summaryOf('first').policy).to.equal(policy);
        expect(summaryOf('first').provenance.policy).to.equal(policy);
      });

      it('makes exactly the same decisions when run again', function () {
        for (const file of LOG_FILES) {
          const first = fs.readFileSync(path.join(outDir, policy, 'first', file));
          expect(first.length, file).to.be.greaterThan(0);
          expect(first.equals(fs.readFileSync(path.join(outDir, policy, 'second', file))), file).to.be.true;
        }
      });
    });
  }
});
