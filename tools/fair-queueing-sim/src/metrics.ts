import type { Provenance } from './provenance';
import { RunResult, Sample } from './simulation';

export interface JobSummary {
  name: string;
  user: string;
  async: boolean;
  granules: number;
  status: string;
  submitMs: number;
  firstStartMs: number | null;
  endMs: number | null;
  // time from submission to completion
  makespanMs: number | null;
  // a lower bound on the makespan if the job had the cluster to itself: for each step, the
  // longer of its longest work item and its total work spread perfectly over the service's pods
  aloneLowerBoundMs: number;
  slowdown: number | null;
  // time from a work item being created (ready) to a pod starting it
  meanWaitMs: number | null;
  p95WaitMs: number | null;
  podTimeMs: number;
}

export interface UserSummary {
  user: string;
  jobs: number;
  podTimeMs: number;
  sharePct: number;
  meanSlowdown: number | null;
  maxSlowdown: number | null;
  // while at least one other user also wanted the same service: the pods this user actually had
  // divided by their max-min fair share of the pods (1.0 = exactly their fair share, less means
  // they were short-changed, more means they got more than their share)
  fairShareRatio: number | null;
}

export interface ServiceSummary {
  service: string;
  pods: number;
  busyPodMs: number;
  utilizationPct: number;
  // pod time spent idle while the service had work ready or queued
  idleWhileReadyPodMs: number;
  // mean over samples with at least two users wanting the service of how close each user's
  // running pods were to their max-min fair share (Jain's index of allocation / fair share;
  // 1.0 means every user had exactly their fair share)
  contendedFairness: number | null;
  contendedSamples: number;
  // policy specific sample values: max and time-weighted mean of each
  policy: Record<string, { max: number; mean: number }>;
}

export interface Summary {
  scenario: string;
  description: string;
  policy: string;
  completed: boolean;
  endMs: number;
  wallMs: number;
  eventsRun: number;
  speedup: number;
  passes: number;
  jobs: JobSummary[];
  users: UserSummary[];
  services: ServiceSummary[];
  sync: { jobs: number; meanMakespanMs: number | null; maxMakespanMs: number | null };
  overall: { meanSlowdown: number | null; maxSlowdown: number | null; meanWaitMs: number | null };
  env: Record<string, string | number>;
  // what a good result looks like for the scenario
  goodOutcome: string;
  // what produced the run (added by the CLI)
  provenance?: Provenance;
}

/**
 * Returns the mean of the values, or null if there are none.
 *
 * @param values - the values
 * @returns the mean
 */
function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Returns the given percentile of the values (nearest rank), or null if there are none.
 *
 * @param values - the values
 * @param p - the percentile, 0 to 100
 * @returns the percentile value
 */
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/**
 * Computes the max-min fair allocation of a capacity among users with the given demands
 * ("water filling"): every user gets an equal share, except that users who want less than that
 * get what they want and the remainder is shared among the rest.
 *
 * @param demands - each user's demand
 * @param capacity - the total capacity
 * @returns each user's fair share
 */
export function maxMinFairShares(demands: Record<string, number>, capacity: number): Record<string, number> {
  const shares: Record<string, number> = {};
  let remaining = capacity;
  let users = Object.keys(demands).filter((u) => demands[u] > 0);
  while (users.length > 0 && remaining > 1e-9) {
    const equal = remaining / users.length;
    const satisfied = users.filter((u) => demands[u] - (shares[u] || 0) <= equal);
    if (satisfied.length === 0) {
      for (const u of users) shares[u] = (shares[u] || 0) + equal;
      remaining = 0;
    } else {
      for (const u of satisfied) {
        remaining -= demands[u] - (shares[u] || 0);
        shares[u] = demands[u];
      }
      users = users.filter((u) => !satisfied.includes(u));
    }
  }
  return shares;
}

/**
 * Returns each user's demand for a service in a sample: the work items they have ready plus
 * those user_work counts as running (which includes items waiting on the service queue).
 *
 * @param sample - the service sample
 * @returns the demand per user, for users with any demand
 */
function sampleDemands(sample: Sample['services'][number]): Record<string, number> {
  const demands: Record<string, number> = {};
  for (const [u, n] of Object.entries(sample.readyByUser)) demands[u] = (demands[u] || 0) + n;
  for (const [u, n] of Object.entries(sample.runningByUser)) demands[u] = (demands[u] || 0) + n;
  return demands;
}

/**
 * Jain's fairness index of allocations normalized by fair share, for one service sample.
 *
 * @param sample - the service sample
 * @returns the index, or null if fewer than two users wanted the service
 */
function sampleFairness(sample: Sample['services'][number]): number | null {
  const demands = sampleDemands(sample);
  const users = Object.keys(demands).filter((u) => demands[u] > 0);
  if (users.length < 2) return null;
  const shares = maxMinFairShares(demands, sample.pods);
  const x = users.map((u) => (sample.busyByUser[u] || 0) / shares[u]);
  const sum = x.reduce((a, b) => a + b, 0);
  const sumSq = x.reduce((a, b) => a + b * b, 0);
  if (sumSq === 0) return null;
  return (sum * sum) / (users.length * sumSq);
}

/**
 * Computes the summary metrics for a run.
 *
 * @param result - the raw run results
 * @returns the summary
 */
export function summarize(result: RunResult): Summary {
  const { scenario } = result;
  const podsByServiceID = Object.fromEntries(scenario.services.map((s) => [s.id, s.pods]));

  // the first time each work item was started by a pod
  const firstStart = new Map<number, number>();
  for (const run of result.runs) {
    if (!firstStart.has(run.workItemID) || run.startMs < firstStart.get(run.workItemID)) {
      firstStart.set(run.workItemID, run.startMs);
    }
  }
  const runEnd = (run: RunResult['runs'][number]): number => run.endMs ?? result.endMs;

  const jobs: JobSummary[] = result.jobs.map((job) => {
    const jobRuns = result.runs.filter((r) => r.jobName === job.name);
    const podTimeMs = jobRuns.reduce((sum, r) => sum + (runEnd(r) - r.startMs), 0);
    let aloneLowerBoundMs = 0;
    for (const [i, serviceID] of job.services.entries()) {
      const stepRuns = jobRuns.filter((r) => r.stepIndex === i + 1);
      const perItem = new Map<number, number>();
      for (const r of stepRuns) perItem.set(r.itemIndex, (perItem.get(r.itemIndex) || 0) + (runEnd(r) - r.startMs));
      const total = [...perItem.values()].reduce((a, b) => a + b, 0);
      const longest = Math.max(0, ...perItem.values());
      aloneLowerBoundMs += Math.max(longest, total / podsByServiceID[serviceID]);
    }
    const waits = result.workItems
      .filter((w) => w.job === job.name && firstStart.has(w.id))
      .map((w) => firstStart.get(w.id) - w.createdMs);
    const starts = jobRuns.map((r) => r.startMs);
    const makespanMs = job.endMs === null ? null : job.endMs - job.submitMs;
    return {
      name: job.name,
      user: job.user,
      async: job.async,
      granules: job.granules,
      status: job.status,
      submitMs: job.submitMs,
      firstStartMs: starts.length ? Math.min(...starts) : null,
      endMs: job.endMs,
      makespanMs,
      aloneLowerBoundMs,
      slowdown: makespanMs !== null && aloneLowerBoundMs > 0 ? makespanMs / aloneLowerBoundMs : null,
      meanWaitMs: mean(waits),
      p95WaitMs: percentile(waits, 95),
      podTimeMs,
    };
  });

  // pod time each user had, and was entitled to, while contending with other users
  const received: Record<string, number> = {};
  const entitled: Record<string, number> = {};
  for (let i = 0; i < result.samples.length - 1; i++) {
    const dt = result.samples[i + 1].t - result.samples[i].t;
    for (const s of result.samples[i].services) {
      const demands = sampleDemands(s);
      if (Object.keys(demands).filter((u) => demands[u] > 0).length < 2) continue;
      const shares = maxMinFairShares(demands, s.pods);
      for (const [u, share] of Object.entries(shares)) {
        received[u] = (received[u] || 0) + (s.busyByUser[u] || 0) * dt;
        entitled[u] = (entitled[u] || 0) + share * dt;
      }
    }
  }

  const totalPodTime = jobs.reduce((sum, j) => sum + j.podTimeMs, 0);
  const users: UserSummary[] = [...new Set(jobs.map((j) => j.user))].map((user) => {
    const userJobs = jobs.filter((j) => j.user === user);
    const podTimeMs = userJobs.reduce((sum, j) => sum + j.podTimeMs, 0);
    const slowdowns = userJobs.map((j) => j.slowdown).filter((s) => s !== null);
    return {
      user,
      jobs: userJobs.length,
      podTimeMs,
      sharePct: totalPodTime > 0 ? (100 * podTimeMs) / totalPodTime : 0,
      meanSlowdown: mean(slowdowns),
      maxSlowdown: slowdowns.length ? Math.max(...slowdowns) : null,
      fairShareRatio: entitled[user] > 0 ? received[user] / entitled[user] : null,
    };
  });

  const services: ServiceSummary[] = scenario.services.map((service) => {
    const busyPodMs = result.runs
      .filter((r) => r.serviceID === service.id)
      .reduce((sum, r) => sum + (runEnd(r) - r.startMs), 0);
    let idleWhileReadyPodMs = 0;
    const fairness: number[] = [];
    const policyTotals: Record<string, { max: number; weighted: number; time: number }> = {};
    for (let i = 0; i < result.samples.length - 1; i++) {
      const s = result.samples[i].services.find((x) => x.service === service.name);
      const dt = result.samples[i + 1].t - result.samples[i].t;
      const ready = Object.values(s.readyByUser).reduce((a, b) => a + b, 0);
      if (ready + s.queued > 0) {
        idleWhileReadyPodMs += (s.pods - s.busyPods) * dt;
      }
      const f = sampleFairness(s);
      if (f !== null) fairness.push(f);
      for (const [k, v] of Object.entries(s.policy || {})) {
        const t = policyTotals[k] || { max: -Infinity, weighted: 0, time: 0 };
        t.max = Math.max(t.max, v);
        t.weighted += v * dt;
        t.time += dt;
        policyTotals[k] = t;
      }
    }
    return {
      service: service.name,
      pods: service.pods,
      busyPodMs,
      utilizationPct: result.endMs > 0 ? (100 * busyPodMs) / (service.pods * result.endMs) : 0,
      idleWhileReadyPodMs,
      contendedFairness: mean(fairness),
      contendedSamples: fairness.length,
      policy: Object.fromEntries(Object.entries(policyTotals).map(([k, t]) => [
        k, { max: t.max, mean: t.time > 0 ? t.weighted / t.time : 0 },
      ])),
    };
  });

  const syncJobs = jobs.filter((j) => !j.async && j.makespanMs !== null);
  const slowdowns = jobs.map((j) => j.slowdown).filter((s) => s !== null);
  const allWaits = jobs.map((j) => j.meanWaitMs).filter((w) => w !== null);
  return {
    scenario: scenario.name,
    description: scenario.description,
    policy: result.policy,
    completed: result.completed,
    endMs: result.endMs,
    wallMs: result.wallMs,
    eventsRun: result.eventsRun,
    speedup: result.wallMs > 0 ? result.endMs / result.wallMs : 0,
    passes: result.decisions.length,
    jobs,
    users,
    services,
    sync: {
      jobs: syncJobs.length,
      meanMakespanMs: mean(syncJobs.map((j) => j.makespanMs)),
      maxMakespanMs: syncJobs.length ? Math.max(...syncJobs.map((j) => j.makespanMs)) : null,
    },
    overall: {
      meanSlowdown: mean(slowdowns),
      maxSlowdown: slowdowns.length ? Math.max(...slowdowns) : null,
      meanWaitMs: mean(allWaits),
    },
    env: result.env,
    goodOutcome: scenario.goodOutcome,
  };
}
