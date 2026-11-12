import { expect } from 'chai';
import { describe, it } from 'mocha';

import { maxMinFairShares, summarize, Summary } from '../src/metrics';
import { resolveScenario } from '../src/scenario';
import type { RunResult } from '../src/simulation';

const MIN = 60_000;

/**
 * A small hand-made run on a 2 pod service. Alice's async job runs both of its work items at
 * once for the first 10 minutes while Bob's sync request waits; Bob's single work item then
 * runs from 10 to 15 minutes, and his job ends at 20 minutes. The samples say that in the first
 * 10 minutes both users wanted the service but only Alice had pods, and that from 10 to 20
 * minutes one pod was idle while a work item sat on the queue.
 *
 * @returns the run
 */
function run(): RunResult {
  const scenario = resolveScenario({
    name: 'metrics-test',
    services: [{ name: 'svc', pods: 2 }],
    jobs: [
      { name: 'alice-1', user: 'alice', granules: 2, steps: [{ service: 'svc', duration: '10m' }] },
      { name: 'bob-sync', user: 'bob', async: false, granules: 1, steps: [{ service: 'svc', duration: '5m' }] },
    ],
  });
  const svc = scenario.services[0].id;
  const runOf = (workItemID: number, jobName: string, user: string, itemIndex: number, pod: string, startMs: number, endMs: number):
  RunResult['runs'][number] => ({ workItemID, jobName, user, serviceID: svc, stepIndex: 1, itemIndex, attempt: 1, pod, startMs, endMs });
  const item = (id: number, job: string, itemIndex: number): RunResult['workItems'][number] => ({
    id, job, serviceID: svc, stepIndex: 1, itemIndex, status: 'successful', createdMs: 0, queuedMs: 0, doneMs: 0, durationMs: 0, retryCount: 0,
  });
  const sample = (t: number, s: Partial<RunResult['samples'][number]['services'][number]>): RunResult['samples'][number] => ({
    t,
    services: [{ service: 'svc', pods: 2, busyPods: 0, queued: 0, readyByUser: {}, runningByUser: {}, busyByUser: {}, ...s }],
  });
  return {
    scenario,
    policy: 'test',
    endMs: 20 * MIN,
    wallMs: 1000,
    eventsRun: 100,
    completed: true,
    jobs: [
      { name: 'alice-1', user: 'alice', async: true, granules: 2, services: [svc], submitMs: 0, endMs: 10 * MIN, status: 'successful' },
      { name: 'bob-sync', user: 'bob', async: false, granules: 1, services: [svc], submitMs: 0, endMs: 20 * MIN, status: 'successful' },
    ],
    runs: [
      runOf(1, 'alice-1', 'alice', 0, 'svc-0', 0, 10 * MIN),
      runOf(2, 'alice-1', 'alice', 1, 'svc-1', 0, 10 * MIN),
      runOf(3, 'bob-sync', 'bob', 0, 'svc-0', 10 * MIN, 15 * MIN),
    ],
    workItems: [item(1, 'alice-1', 0), item(2, 'alice-1', 1), item(3, 'bob-sync', 0)],
    decisions: [{ t: 0, service: svc, batchSize: 2, takes: [['alice-1', 2, 2]] }],
    samples: [
      sample(0, { busyPods: 2, readyByUser: { bob: 1 }, runningByUser: { alice: 2 }, busyByUser: { alice: 2 } }),
      sample(10 * MIN, { busyPods: 1, queued: 1, runningByUser: { bob: 1 }, busyByUser: { bob: 1 } }),
      sample(20 * MIN, {}),
    ],
    env: {},
  };
}

describe('metrics', function () {
  describe('maxMinFairShares', function () {
    it('gives every user what they want when there is enough to go round', function () {
      expect(maxMinFairShares({ a: 1, b: 2 }, 10)).to.deep.equal({ a: 1, b: 2 });
    });

    it('splits the capacity equally between users who all want more than an equal share', function () {
      expect(maxMinFairShares({ a: 10, b: 10 }, 4)).to.deep.equal({ a: 2, b: 2 });
    });

    it('shares what small users leave among the others', function () {
      expect(maxMinFairShares({ a: 1, b: 5, c: 5 }, 7)).to.deep.equal({ a: 1, b: 3, c: 3 });
    });

    it('leaves out users with no demand', function () {
      expect(maxMinFairShares({ a: 0, b: 3 }, 2)).to.deep.equal({ b: 2 });
    });

    it('treats usernames that are also object property names as ordinary users', function () {
      expect({ ...maxMinFairShares({ constructor: 5, toString: 5 }, 4) }).to.deep.equal({ constructor: 2, toString: 2 });
    });
  });

  describe('summarize', function () {
    let summary: Summary;
    before(function () {
      summary = summarize(run());
    });

    const job = (name: string): Summary['jobs'][number] => summary.jobs.find((j) => j.name === name);
    const user = (name: string): Summary['users'][number] => summary.users.find((u) => u.user === name);

    it('measures each job\'s makespan from submission to completion', function () {
      expect(job('alice-1').makespanMs).to.equal(10 * MIN);
      expect(job('bob-sync').makespanMs).to.equal(20 * MIN);
    });

    it('divides the makespan by a lower bound on how long the job takes alone', function () {
      // alice: 20 minutes of work over 2 pods, and no item longer than 10 minutes
      expect(job('alice-1').aloneLowerBoundMs).to.equal(10 * MIN);
      expect(job('alice-1').slowdown).to.equal(1);
      // bob: one 5 minute item
      expect(job('bob-sync').aloneLowerBoundMs).to.equal(5 * MIN);
      expect(job('bob-sync').slowdown).to.equal(4);
    });

    it('measures waits from a work item being ready to a pod starting it', function () {
      expect(job('alice-1').meanWaitMs).to.equal(0);
      expect(job('bob-sync').meanWaitMs).to.equal(10 * MIN);
    });

    it('compares the pods each user had with their fair share while users competed', function () {
      // in the first 10 minutes each user's fair share was 1 pod; alice had 2 and bob none
      expect(user('alice').fairShareRatio).to.equal(2);
      expect(user('bob').fairShareRatio).to.equal(0);
    });

    it('averages Jain\'s index over the samples where two or more users wanted the service', function () {
      const [service] = summary.services;
      expect(service.contendedSamples).to.equal(1);
      expect(service.contendedFairness).to.equal(0.5);
    });

    it('counts pod time idle while work was ready or queued', function () {
      expect(summary.services[0].idleWhileReadyPodMs).to.equal(10 * MIN);
    });

    it('measures utilization as busy pod time over pods x simulated time', function () {
      // 25 pod-minutes of work on 2 pods over 20 minutes
      expect(summary.services[0].utilizationPct).to.equal(62.5);
    });

    it('summarizes sync requests and the run as a whole', function () {
      // Bob's request took 20 minutes for 5 minutes of work
      expect(summary.sync).to.deep.equal({
        jobs: 1, unfinished: 0, meanMakespanMs: 20 * MIN, maxMakespanMs: 20 * MIN,
        meanLatencyMs: 15 * MIN, p95LatencyMs: 15 * MIN, maxLatencyMs: 15 * MIN,
      });
      expect(summary.overall).to.deep.equal({ meanSlowdown: 2.5, maxSlowdown: 4, meanWaitMs: 5 * MIN });
    });

    it('counts sync requests submitted but not finished as unfinished, and not ones never submitted', function () {
      const r = run();
      const { services } = r.jobs[1];
      r.jobs.push(
        { name: 'bob-late', user: 'bob', async: false, granules: 1, services, submitMs: 15 * MIN, endMs: null, status: 'running' },
        { name: 'bob-never', user: 'bob', async: false, granules: 1, services, submitMs: 30 * MIN, endMs: null, status: 'not submitted' },
      );
      expect(summarize(r).sync.unfinished).to.equal(1);
    });
  });
});
