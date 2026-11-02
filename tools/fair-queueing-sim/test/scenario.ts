import * as fs from 'fs';
import * as path from 'path';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { mulberry32 } from '../src/rng';
import {
  durationSpecForItem, formatDuration, loadScenario, parseDuration, resolveScenario, sampleDuration, Scenario,
} from '../src/scenario';

const SCENARIOS_DIR = path.resolve(__dirname, '..', 'scenarios');

// the smallest valid scenario, for tests to add to
const minimal = (): Scenario => ({
  name: 'test',
  services: [{ name: 'svc', pods: 2 }],
  jobs: [{ name: 'job-1', user: 'alice', granules: 3, steps: [{ service: 'svc', duration: '1m' }] }],
});

describe('scenario', function () {
  describe('parseDuration', function () {
    it('passes numbers through as milliseconds', function () {
      expect(parseDuration(1500)).to.equal(1500);
    });

    it('parses every unit', function () {
      expect(parseDuration('250ms')).to.equal(250);
      expect(parseDuration('30s')).to.equal(30_000);
      expect(parseDuration('10m')).to.equal(600_000);
      expect(parseDuration('1.5h')).to.equal(5_400_000);
      expect(parseDuration('2d')).to.equal(172_800_000);
    });

    it('allows surrounding and inner whitespace', function () {
      expect(parseDuration(' 2 m ')).to.equal(120_000);
    });

    it('rejects anything else', function () {
      for (const bad of ['10', '10 minutes', '-1s', 'm', '']) {
        expect(() => parseDuration(bad), bad).to.throw(/Invalid duration/);
      }
    });
  });

  describe('formatDuration', function () {
    it('formats each range of durations', function () {
      expect(formatDuration(250)).to.equal('250ms');
      expect(formatDuration(42_000)).to.equal('42.0s');
      expect(formatDuration(65_000)).to.equal('1m 05s');
      expect(formatDuration(3_900_000)).to.equal('1h 05m');
    });

    it('shows a missing value as a dash', function () {
      expect(formatDuration(null)).to.equal('-');
      expect(formatDuration(undefined)).to.equal('-');
      expect(formatDuration(NaN)).to.equal('-');
    });
  });

  describe('sampleDuration', function () {
    it('returns fixed durations unchanged', function () {
      const random = mulberry32(1);
      expect(sampleDuration('30s', random)).to.equal(30_000);
      expect(sampleDuration({ dist: 'fixed', value: '2m' }, random)).to.equal(120_000);
    });

    it('keeps uniform draws within their range', function () {
      const random = mulberry32(1);
      for (let i = 0; i < 1000; i++) {
        expect(sampleDuration({ dist: 'uniform', min: '30s', max: '90s' }, random)).to.be.within(30_000, 90_000);
      }
    });

    it('draws exponential durations with the given mean', function () {
      const random = mulberry32(2);
      const values = Array.from({ length: 20_000 }, () => sampleDuration({ dist: 'exponential', mean: '1m' }, random));
      expect(values.reduce((a, b) => a + b, 0) / values.length).to.be.closeTo(60_000, 1500);
    });

    it('draws lognormal durations with the given median', function () {
      const random = mulberry32(3);
      const values = Array.from({ length: 20_001 }, () => sampleDuration({ dist: 'lognormal', median: '1m', sigma: 0.5 }, random))
        .sort((a, b) => a - b);
      expect(values[10_000]).to.be.closeTo(60_000, 1500);
    });

    it('picks mix options in proportion to their weights', function () {
      const random = mulberry32(4);
      const spec = { dist: 'mix' as const, options: [{ weight: 3, duration: '1m' }, { weight: 1, duration: '1h' }] };
      const values = Array.from({ length: 10_000 }, () => sampleDuration(spec, random));
      expect(values.every((v) => v === 60_000 || v === 3_600_000)).to.be.true;
      expect(values.filter((v) => v === 3_600_000).length / values.length).to.be.closeTo(0.25, 0.02);
    });

    it('never returns less than 1ms', function () {
      expect(sampleDuration(0, mulberry32(1))).to.equal(1);
    });

    it('rejects an unknown distribution', function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => sampleDuration({ dist: 'pareto' } as any, mulberry32(1))).to.throw(/Unknown duration distribution/);
    });

    it('gives the same durations for the same stream', function () {
      const spec = { dist: 'uniform' as const, min: '1s', max: '1h' };
      const a = mulberry32(9);
      const b = mulberry32(9);
      for (let i = 0; i < 10; i++) expect(sampleDuration(spec, a)).to.equal(sampleDuration(spec, b));
    });
  });

  describe('durationSpecForItem', function () {
    const step = {
      service: 'svc',
      duration: '1m',
      phases: [{ fromItem: 10, duration: '20m' }, { fromItem: 20, duration: '2m' }],
    };

    it('uses the step duration before the first phase', function () {
      expect(durationSpecForItem(step, 9)).to.equal('1m');
    });

    it('uses the latest phase an item has reached', function () {
      expect(durationSpecForItem(step, 10)).to.equal('20m');
      expect(durationSpecForItem(step, 19)).to.equal('20m');
      expect(durationSpecForItem(step, 20)).to.equal('2m');
    });
  });

  describe('resolveScenario', function () {
    it('fills in the defaults', function () {
      const s = resolveScenario(minimal());
      expect(s.seed).to.equal(1);
      expect(s.maxDurationMs).to.equal(7 * 86_400_000);
      expect(s.policy).to.equal('slot-based');
      expect(s.services[0].id).to.equal('harmonyservices/sim-svc:latest');
      expect(s.jobs[0]).to.include({ submitAtMs: 0, async: true, granules: 3, ignoreErrors: true });
      expect(s.infrastructure).to.include({ schedulerPods: 1, updaterPods: 1, sampleIntervalMs: 30_000 });
    });

    it('converts environment values to strings', function () {
      const s = resolveScenario({ ...minimal(), env: { A: 3, B: true, C: 'x' } });
      expect(s.env).to.deep.equal({ A: '3', B: 'true', C: 'x' });
    });

    it('orders jobs by submit time, keeping the file order for ties', function () {
      const step = [{ service: 'svc', duration: '1m' }];
      const s = resolveScenario({
        ...minimal(),
        jobs: [
          { name: 'late', user: 'a', granules: 1, submitAt: '5m', steps: step },
          { name: 'first', user: 'a', granules: 1, steps: step },
          { name: 'second', user: 'b', granules: 1, steps: step },
        ],
      });
      expect(s.jobs.map((j) => j.name)).to.deep.equal(['first', 'second', 'late']);
    });

    it('draws a granule count from a range the same way every time', function () {
      const scenario = { ...minimal(), jobs: [{ ...minimal().jobs[0], granules: { min: 5, max: 9 } }] };
      const { granules } = resolveScenario(scenario).jobs[0];
      expect(granules).to.be.within(5, 9);
      expect(resolveScenario(scenario).jobs[0].granules).to.equal(granules);
    });

    it('expands generators into jobs until their count or end time', function () {
      const job = { granules: 1, steps: [{ service: 'svc', duration: '1m' }] };
      const s = resolveScenario({
        ...minimal(),
        jobs: [],
        generators: [
          { name: 'counted', user: 'a', every: '10m', count: 3, job },
          { name: 'timed', user: 'b', start: '5m', every: '10m', until: '30m', job },
        ],
      });
      expect(s.jobs.filter((j) => j.user === 'a').map((j) => [j.name, j.submitAtMs]))
        .to.deep.equal([['counted-1', 0], ['counted-2', 600_000], ['counted-3', 1_200_000]]);
      expect(s.jobs.filter((j) => j.user === 'b').map((j) => j.submitAtMs)).to.deep.equal([300_000, 900_000, 1_500_000]);
    });

    describe('rejects invalid scenarios', function () {
      const step = [{ service: 'svc', duration: '1m' }];
      const cases: [string, Scenario, RegExp][] = [
        ['no name', { ...minimal(), name: '' }, /must have a name/],
        ['no services', { ...minimal(), services: [] }, /at least one service/],
        ['a job without a user', { ...minimal(), jobs: [{ name: 'j', user: '', granules: 1, steps: step }] }, /name and a user/],
        ['duplicate job names', { ...minimal(), jobs: [minimal().jobs[0], minimal().jobs[0]] }, /Duplicate job name/],
        ['a job with no steps', { ...minimal(), jobs: [{ name: 'j', user: 'a', granules: 1, steps: [] }] }, /has no steps/],
        ['a job with no granules', { ...minimal(), jobs: [{ name: 'j', user: 'a', granules: 0, steps: step }] }, /at least one granule/],
        ['an unknown service', { ...minimal(), jobs: [{ name: 'j', user: 'a', granules: 1, steps: [{ service: 'nope', duration: '1m' }] }] }, /unknown service/],
        ['a service used twice in one job', { ...minimal(), jobs: [{ name: 'j', user: 'a', granules: 1, steps: [...step, ...step] }] }, /more than once/],
        ['an invalid duration', { ...minimal(), jobs: [{ name: 'j', user: 'a', granules: 1, steps: [{ service: 'svc', duration: 'soon' }] }] }, /Invalid duration/],
        ['a benchmark without a metric', { ...minimal(), benchmarks: [{ metric: '' }] }, /needs a metric/],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ['a benchmark with an invalid direction', { ...minimal(), benchmarks: [{ metric: 'fairness', better: 'up' as any }] }, /must be "lower" or "higher"/],
      ];
      for (const [what, scenario, error] of cases) {
        it(`with ${what}`, function () {
          expect(() => resolveScenario(scenario)).to.throw(error);
        });
      }
    });
  });

  describe('loadScenario', function () {
    const files = [
      ...fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.yml')).map((f) => path.join(SCENARIOS_DIR, f)),
      ...fs.readdirSync(path.join(SCENARIOS_DIR, 'stories')).map((f) => path.join(SCENARIOS_DIR, 'stories', f)),
    ];

    for (const file of files) {
      it(`loads ${path.relative(SCENARIOS_DIR, file)}`, function () {
        const s = loadScenario(file);
        expect(s.jobs.length).to.be.greaterThan(0);
      });
    }

    it('uses a given seed instead of the scenario\'s own', function () {
      expect(loadScenario(path.join(SCENARIOS_DIR, 'smoke.yml'), 101).seed).to.equal(101);
    });
  });
});
