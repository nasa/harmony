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

  describe('with a serial generator', function () {
    const dir = path.join(os.tmpdir(), `fq-sim-serial-${process.pid}`);
    let summary: Summary;
    before(async function () {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'serial.yml');
      // YAML is a superset of JSON
      fs.writeFileSync(file, JSON.stringify({
        name: 'serial',
        maxDuration: '1h',
        services: [{ name: 'svc', pods: 2 }],
        generators: [{
          name: 'one-at-a-time', user: 'carol', every: '30s', count: 3, serial: true,
          job: { granules: 2, steps: [{ service: 'svc', duration: '10s' }] },
        }],
      }));
      await runChild({ file, scenarioName: 'serial', policy: 'slot-based', runDir: path.join(dir, 'run'), sets: {} });
      summary = JSON.parse(fs.readFileSync(path.join(dir, 'run', 'summary.json'), 'utf8'));
    });

    after(function () {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('submits each job 30 seconds after the one before finishes', function () {
      expect(summary.completed).to.be.true;
      const { jobs } = summary;
      expect(jobs.map((j) => j.name)).to.deep.equal(['one-at-a-time-1', 'one-at-a-time-2', 'one-at-a-time-3']);
      expect(jobs[0].submitMs).to.equal(0);
      for (let i = 1; i < jobs.length; i++) {
        expect(jobs[i].submitMs, jobs[i].name).to.equal(jobs[i - 1].submitMs + jobs[i - 1].makespanMs + 30_000);
      }
    });
  });
});
