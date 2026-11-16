import * as fs from 'fs';
import * as path from 'path';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { extractMetrics, formatMetric, mean, metricKind } from '../src/bench-metrics';
import type { Summary } from '../src/metrics';
import { loadScenario } from '../src/scenario';

const STORIES_DIR = path.resolve(__dirname, '..', 'scenarios', 'stories');

/**
 * A summary with just the fields the bench metrics read.
 *
 * @returns the summary
 */
function summary(): Summary {
  return {
    completed: true,
    endMs: 3_723_456.7,
    overall: { meanSlowdown: 1.234567, maxSlowdown: 2, meanWaitMs: 1000 },
    sync: { jobs: 0, unfinished: 2, meanMakespanMs: null, maxMakespanMs: null },
    services: [
      { contendedFairness: 0.5, utilizationPct: 80, idleWhileReadyPodMs: 1_800_000 },
      { contendedFairness: null, utilizationPct: 60, idleWhileReadyPodMs: 1_800_000 },
    ],
    jobs: [{ name: 'alice.big', makespanMs: 60_000.4, slowdown: 1.5, meanWaitMs: null }],
    users: [{ user: 'alice', fairShareRatio: 1, meanSlowdown: 1.5, maxSlowdown: 1.5 }],
  } as unknown as Summary;
}

describe('bench-metrics', function () {
  describe('metricKind', function () {
    it('describes scenario wide metrics', function () {
      expect(metricKind('overall.meanSlowdown')).to.include({ label: 'mean job slowdown', better: 'lower', format: 'ratio' });
      expect(metricKind('fairness')).to.include({ better: 'higher' });
    });

    it('describes job and user metrics, including names that contain dots', function () {
      expect(metricKind('job.bob-sync.makespan')).to.deep.equal({ label: 'bob-sync makespan', better: 'lower', format: 'duration' });
      expect(metricKind('job.alice.big.slowdown')).to.include({ label: 'alice.big slowdown' });
      expect(metricKind('user.judy.fairShare')).to.deep.equal({ label: 'judy fair share', better: 'higher', format: 'ratio' });
    });

    it('returns null for anything that isn\'t a metric', function () {
      expect(metricKind('nonsense')).to.be.null;
      expect(metricKind('job.bob-sync.colour')).to.be.null;
      expect(metricKind('user.judy.makespan')).to.be.null;
    });

    it('doesn\'t treat inherited object properties as metrics', function () {
      expect(metricKind('constructor')).to.be.null;
      expect(metricKind('toString')).to.be.null;
      expect(metricKind('job.bob-sync.constructor')).to.be.null;
      expect(metricKind('user.judy.hasOwnProperty')).to.be.null;
    });
  });

  describe('extractMetrics', function () {
    const metrics = extractMetrics(summary());

    it('reads every scenario, job and user metric', function () {
      expect(Object.keys(metrics)).to.include.members([
        'overall.meanSlowdown', 'sync.maxMakespan', 'fairness', 'utilization', 'idlePodHours', 'simulatedTime',
        'job.alice.big.makespan', 'job.alice.big.slowdown', 'job.alice.big.meanWait',
        'user.alice.fairShare', 'user.alice.meanSlowdown', 'user.alice.maxSlowdown',
      ]);
    });

    it('averages utilization and fairness over services (leaving out ones with no fairness) and totals idle time', function () {
      expect(metrics.utilization).to.equal(70);
      expect(metrics.fairness).to.equal(0.5);
      expect(metrics.idlePodHours).to.equal(1);
    });

    it('rounds durations to whole milliseconds and everything else to four places', function () {
      expect(metrics.simulatedTime).to.equal(3_723_457);
      expect(metrics['job.alice.big.makespan']).to.equal(60_000);
      expect(metrics['overall.meanSlowdown']).to.equal(1.2346);
    });

    it('records missing values as null', function () {
      expect(metrics['sync.maxMakespan']).to.be.null;
      expect(metrics['job.alice.big.meanWait']).to.be.null;
    });

    it('counts the sync requests the latency figures leave out because they hadn\'t finished', function () {
      expect(metrics['sync.unfinished']).to.equal(2);
    });

    it('records whether the run finished all its work', function () {
      expect(metrics.completed).to.equal(100);
    });

    describe('for a run that reached its maxDuration with work unfinished', function () {
      const incomplete = extractMetrics({ ...summary(), completed: false });

      it('records it as not completed', function () {
        expect(incomplete.completed).to.equal(0);
      });

      it('has no simulated time, which is the time until every job finished', function () {
        expect(incomplete.simulatedTime).to.be.null;
      });

      it('still records its other metrics', function () {
        expect(incomplete['overall.meanSlowdown']).to.equal(1.2346);
        expect(incomplete.fairness).to.equal(0.5);
      });
    });
  });

  describe('formatMetric', function () {
    it('formats each kind of value', function () {
      expect(formatMetric(65_000, 'duration')).to.equal('1m 05s');
      expect(formatMetric(97.44, 'percent')).to.equal('97.4%');
      expect(formatMetric(0.354, 'podHours')).to.equal('0.35 pod-h');
      expect(formatMetric(1.026, 'ratio')).to.equal('1.03');
      expect(formatMetric(3, 'count')).to.equal('3');
      expect(formatMetric(0.4, 'count')).to.equal('0.4');
    });
  });

  describe('mean', function () {
    it('returns the mean, or null when there are no values', function () {
      expect(mean([])).to.be.null;
      expect(mean([1, 2, 6])).to.equal(3);
    });
  });

  describe('the stories\' protected metrics', function () {
    for (const file of fs.readdirSync(STORIES_DIR)) {
      it(`are all metrics of jobs and users in ${file}`, function () {
        const scenario = loadScenario(path.join(STORIES_DIR, file));
        expect(scenario.benchmarks.length, 'protected metrics').to.be.greaterThan(0);
        const jobs = new Set(scenario.jobs.map((j) => j.name));
        const users = new Set(scenario.jobs.map((j) => j.user));
        for (const { metric } of scenario.benchmarks) {
          expect(metricKind(metric), metric).to.not.be.null;
          const [kind, ...rest] = metric.split('.');
          const name = rest.slice(0, -1).join('.');
          if (kind === 'job') expect(jobs.has(name), `${metric}: no job ${name}`).to.be.true;
          if (kind === 'user') expect(users.has(name), `${metric}: no user ${name}`).to.be.true;
        }
      });
    }
  });
});
