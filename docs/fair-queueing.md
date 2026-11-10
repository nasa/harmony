# Fair Queueing <!-- omit in toc -->

**IMPORTANT! This documentation concerns features under active development. The algorithm described here may undergo changes in the future.**

## Table of Contents<!-- omit in toc -->
- [Introduction](#introduction)
- [Background](#background)
- [The Algorithm](#the-algorithm)
- [Work Item Duration Tracking](#work-item-duration-tracking)
- [Duration Based Fair Queueing (Experimental)](#duration-based-fair-queueing-experimental)
  - [Ranking Users by Expected Runtime](#ranking-users-by-expected-runtime)
  - [The Fast Lane Reserve](#the-fast-lane-reserve)
- [Adaptive Fast Lane Fair Queueing (Experimental)](#adaptive-fast-lane-fair-queueing-experimental)
- [Fair Queueing Policies](#fair-queueing-policies)

## Introduction
Harmony supports two goals with regard to processing work for users. These are referred to
collectively as _fair queueing_:

* When a user performs a Harmony request and no other users are currently in the system, Harmony provides all available resources to that user
* When a user performs a Harmony request and other users currently have requests pending in the system, Harmony shares available resources evenly between the user requests (prioritizing synchronous calls)

## Background
Harmony orchestrates multiple services that can be invoked on data. These services
can be chained together (where appropriate) to form complex workflows involving both
sequential services chains in which the output of one service becomes the input of the
next service, as well as output aggregation where a services receives the output from
multiple services as its input.

Workers for each service are run as pods in a Kubernetes cluster. These workers
request a unit of work (a 'work item') from the Harmony backend, process the associated work item, save the results in S3, then send a status update to the Harmony backend.

Fair queueing is the process by which Harmony decides which work item to send to a service
requesting work. More generally, it answers the question, "of the users needing work
performed by a given service, which user should go next?".

## The Algorithm
By default Harmony uses _slot based_ fair queueing: each running work item occupies one slot, and
users with the fewest slots in use go first. (Experimental
[duration based](#duration-based-fair-queueing-experimental) and
[adaptive fast lane](#adaptive-fast-lane-fair-queueing-experimental) variants can be selected
instead with the work-scheduler's `FAIR_QUEUEING_POLICY`.)

The real scheduling path batches work across many jobs and users at once, rather than picking one
user then one job at a time.

When the work-scheduler needs to fill a service's queue (`services/work-scheduler/app/workers/scheduler.ts`),
it works out how many items to request and asks for them in batches of at most
`WORK_ITEM_SCHEDULER_BATCH_SIZE`. For each batch:

1. `getNextJobIds` (`user-work.ts`) identifies all jobs with ready work for the service and groups
   them by user
2. For each user, it computes the number of slots that user has in use **for this service**: the
   sum of `running_count` across that user's `user_work` rows for the service. Work the user has
   running on other services doesn't count, since it doesn't occupy this service's pods
3. Each user's own jobs are ranked with their synchronous jobs ahead of their asynchronous ones,
   then least-to-most-recently-worked; all users' jobs are then interleaved into rounds: round 1 is
   every user's top-ranked job, round 2 is every user's next job, and so on. Within a round, the
   user with the fewest slots in use for the service goes first; ties go to whoever was served
   longest ago for the service
4. The top `batchSize` jobs by that interleaved order are selected and locked with
   `FOR UPDATE ... SKIP LOCKED`, so multiple scheduler pods can't hand out the same work
5. The [fair queueing policy](#fair-queueing-policies) (`fair-queueing-policy.ts`, called from
   `getWorkItemsFromDatabase` in `work-item-polling.ts`) shuffles the selected jobs (so that any jobs
   left over when the batch doesn't divide evenly aren't always the same ones at the end of the
   list), then gives each job `ceil(remaining batch ÷ remaining jobs)` work items, picking the
   lowest-ID ready items for that job. This shuffle only affects how the batch's items are split
   across the jobs already selected in step 4 - it has no bearing on which jobs made it into the
   batch, or their priority order within it
6. Each returned row's `last_worked` column is updated to indicate work being done for that user
   and job at the current point in time

Steps 1-6 happen inside a single database transaction per batch.

If sending a work item to the service's queue fails after the batch's transaction has committed,
the scheduler reverts that item and the rest of the batch that hasn't been sent yet back to `ready`
(restoring the `user_work` counts) so they don't stay orphaned in the `queued` state holding a slot.

This satisfies the first requirement in [Introduction](#introduction): if one user is alone in the
system, every round is that user's job, so they get the whole batch. It also satisfies the second:
round-robin interleaving means no single user can fill a batch, the user with the least work in
flight goes first within a round, and a user's synchronous jobs are always ranked ahead of their
asynchronous ones. Note that synchronous-job priority is scoped to each user's own jobs - it
doesn't let one user's synchronous job jump ahead of another user's earlier round.

## Work Item Duration Tracking
Regardless of which algorithm is in use, when a work item completes `decrementRunningCount`
updates the `average_duration` and `completed_count` columns of its `user_work` row with a
cumulative mean incorporating the completed work item's duration. Only successful (and warning)
work items are included. A failed work item (after any retries) instead increments
`failed_count` and adds its duration to `failed_sum_duration_ms`, so that work items that fail
quickly, or time out, don't skew the average (they're only used to classify a job that has no
successful work items yet - see [The Fast Lane Reserve](#the-fast-lane-reserve)). Canceled work items aren't recorded at all. This
happens in the work-updater's own transaction, not the scheduling batch above. Slot based fair
queueing ignores these columns; they are collected so that the duration based and adaptive fast
lane policies have measurements to use if one of them is selected.

### Duration History
`user_work` rows are deleted as soon as a job has no more work for a service, when the job
finishes, and when the job is paused, so that the scheduling queries (which read every row for a
service) only see active work. Before a row is deleted its totals are moved to the
`user_work_history` table, which has at most one row per job and service:

* When a paused job is resumed, its totals are restored from `user_work_history` to its new
  `user_work` rows, so the job keeps its measured `average_duration` across any number of pauses.
  Because the restored row carries the full totals, the next time it is deleted it overwrites the
  history row rather than adding to it.
* Work items that were already running when the job was paused keep running, and when they
  complete their durations are added directly to the job's `user_work_history` row.
* New jobs (and resumed jobs with no measurement yet for a service) have their `average_duration`
  _seeded_ from the user's most recent jobs for the service within the last
  `USER_WORK_DURATION_SEED_LOOKBACK_DAYS` (0 disables seeding). `completed_count` stays 0, so the
  job's first measured duration replaces the seed. This lets the duration based and adaptive fast
  lane policies classify a job before any of its own work items complete.
* The cron service deletes rows for finished jobs after `USER_WORK_HISTORY_RETENTION_DAYS`. The
  table is also propagated to Iceberg by the analytics cron, where rows are kept.

## Duration Based Fair Queueing (Experimental)
Duration based fair queueing is disabled by default. It is selected by setting
`FAIR_QUEUEING_POLICY=duration-based` for the work-scheduler (or, the older setting,
`ENABLE_DURATION_BASED_FAIR_QUEUEING=true`), and changes the [algorithm](#the-algorithm) above in
two ways, described below. `SLOW_WORK_THRESHOLD_MS` and `FAST_LANE_RESERVE_FRACTION` only take
effect when it is selected (and `SLOW_WORK_THRESHOLD_MS` also with
[adaptive fast lane](#adaptive-fast-lane-fair-queueing-experimental) fair queueing).

### Ranking Users by Expected Runtime
In step 2, instead of counting slots for the service, each user's _expected runtime_ of work
currently in progress **for this service** is computed: the sum, across that user's `user_work`
rows for the service, of `running_count × duration` (the same duration used to classify slow work,
described below, with a default of one hour for rows whose duration hasn't been measured yet). As with slots, work the user has
running on other services doesn't count. In step 3, the user with the least expected runtime for
the service goes first within a round, with ties going to whoever was served longest ago for the
service. This means a user with a few long-running work items can rank behind a user with many
short ones.

### The Fast Lane Reserve
Some services see most work items complete quickly, but occasionally process a request whose work
items run far longer than usual (e.g. a very large or complex granule). Left unchecked, a handful
of users with slow-running work can consume all of a service's pods, starving every other user of
fast-completing work even though those other users would otherwise barely compete for capacity.

To prevent this, Harmony caps how much of each service's capacity (its current running pod count)
slow work may occupy at once, reserving the rest for "fast" work:

* A `(job_id, service_id)` pair - tracked by its row in `user_work` - is classified as **slow** once
  its _duration_ exceeds `SLOW_WORK_THRESHOLD_MS`, and as **fast** if its duration is at or below
  that threshold, or if no work item for that job and service has completed yet (so a new job's
  duration can be measured without being treated as slow by default). Its duration is normally its
  `average_duration`. A job with no successful work items yet but some failed ones is instead
  classified by the average duration of its failed work items
  (`failed_sum_duration_ms / failed_count`), so a job whose work items keep failing slowly (e.g.
  timing out) is still treated as slow. This takes precedence over a seeded `average_duration`
  (see [Duration History](#duration-history)), which otherwise classifies the job the same way a
  measured one does.
* `FAST_LANE_RESERVE_FRACTION` (default `0.3`, i.e. 30%) is the fraction of a service's running pod
  count reserved for fast work. The remaining share is the **slow work capacity**:
  `max(1, floor(servicePodCount × (1 - FAST_LANE_RESERVE_FRACTION)))` - 7 slots with 10 pods.
* When scheduling work for a service, Harmony sums the `running_count` of only that service's
  `user_work` rows that are actively slow to get the number of slow work items currently in flight.
  Fast and not-yet-measured work never counts against the slow work capacity.
* While slow work in flight is below the slow work capacity, slow jobs are eligible and are
  ranked by exactly the same rules as all other jobs, including synchronous-job priority. Each
  scheduling pass hands out at most the remaining slow work slots to slow jobs, so a single batch
  cannot overshoot the capacity.
* Once slow work in flight reaches the slow work capacity, rows measured as slow are skipped even
  though they have ready work, until slow work items complete and free up slots.
* A user or job never-before-measured for a service is still eligible while slow work is blocked,
  as long as it has no other work currently running for that job and service - this is what lets
  Harmony measure a new job's duration rather than permanently assuming the worst about it.
* Each scheduling batch first checks, without locking, whether the service has slow work ready
  and slow work capacity free. Only if both are true does it take a per-service
  transaction-scoped advisory lock (`pg_advisory_xact_lock`, postgres only) and re-read the slow
  work in flight, so concurrent scheduler pods can't both see capacity available and jointly admit
  more slow work than the reserve allows. Batches that can't schedule slow work skip the lock (and
  hand out no slow work items), so they never wait on other scheduler pods - only batches that
  actually admit slow work are serialized.

This means slow work is only held back when it is already using a large share of the service, so a
service busy with slow work still makes forward progress on fast work, while slow work is never
starved outright.

## Adaptive Fast Lane Fair Queueing (Experimental)
Adaptive fast lane fair queueing is selected by setting `FAIR_QUEUEING_POLICY=adaptive-fast-lane`
for the work-scheduler. It is [duration based fair queueing](#duration-based-fair-queueing-experimental)
with changes that stop one user's slow work items from taking over a service, chosen by comparing
the policies with the fair queueing simulator. `tools/fair-queueing-sim/RESULTS.md` records how it
compares with slot based and duration based fair queueing, and how to reproduce the comparison.
The changes:

* **A smaller reserve.** Slow work may use all but `ADAPTIVE_FAST_LANE_RESERVE_FRACTION` (default
  `0.1`, i.e. 10%) of a service's pods, rather than `FAST_LANE_RESERVE_FRACTION` (30%): 9 slots
  with 10 pods. The value `scheduler` uses `FAST_LANE_RESERVE_FRACTION` instead.
* **New jobs are limited until they're measured.** Duration based fair queueing treats a job with
  no measured duration as fast, so on an idle service a new job whose work items turn out to take
  an hour can take every pod before one of them finishes. Here a `(job_id, service_id)` with no
  measured duration may only run `ADAPTIVE_FAST_LANE_UNMEASURED_LIMIT` (2) work items, plus a share
  of an allowance for all of the service's unmeasured work (`ADAPTIVE_FAST_LANE_UNMEASURED_FRACTION`,
  half of the slow work capacity). Unmeasured work beyond its limit counts against the slow work
  capacity, so it never takes the reserve. Once one of its work items has been running for longer
  than `SLOW_WORK_THRESHOLD_MS`, it's treated as slow without waiting for that work item to finish.
* **Every user is held to their fair share while others wait.** While another user below their
  max-min fair share of the service's pods has work ready, a user only gets new work items up to
  their own share. Nothing running is interrupted, and any of the batch the waiting users can't
  take goes to the users held back, so this never leaves pods idle. Without it, a user whose work
  items take minutes - too long to share pods well, but under the slow work threshold - keeps
  accumulating pods.
* **Batches are split between users first**, then between each user's jobs, so a user with many
  jobs doesn't get more of the service than a user with one.
* **Sync requests go first.** Each batch goes to the selected jobs' sync requests before it's
  split, and fair share never holds a sync request back.
* **New jobs are ranked by a realistic expected runtime.** When users are ranked, running work
  that hasn't been measured counts as the service's mean measured duration rather than an hour.

Like duration based fair queueing it leaves pods idle by design when only slow work is waiting
(the reserve), and because new jobs are limited until they're measured, the reserve holds from the
start.

Each change can be switched off with its `ADAPTIVE_FAST_LANE_*` setting (see the work-scheduler's
`env-defaults`), which is read on every scheduling pass. With all of them off and
`ADAPTIVE_FAST_LANE_RESERVE_FRACTION=scheduler`, it makes exactly the same decisions as duration
based fair queueing. It uses the durations Harmony already records (see
[Work Item Duration Tracking](#work-item-duration-tracking)), so selecting it needs no schema
changes, and going back is setting `FAIR_QUEUEING_POLICY=slot-based`. The policy, and the reason
for each change, is described in
`services/harmony/app/backends/workflow-orchestration/adaptive-fast-lane-policy.ts`.

## Fair Queueing Policies

The scheduling decision - which jobs get work items, and how many, each time the work-scheduler
fills a service's queue - is made by a _fair queueing policy_ (see
`services/harmony/app/backends/workflow-orchestration/fair-queueing-policy.ts`). The
work-scheduler's `FAIR_QUEUEING_POLICY` selects one of three:

* `slot-based` (`slotBasedPolicy`) - [slot based fair queueing](#the-algorithm), the default
* `duration-based` (`durationBasedPolicy`) -
  [duration based fair queueing](#duration-based-fair-queueing-experimental). The older
  `ENABLE_DURATION_BASED_FAIR_QUEUEING=true` also selects it, unless `FAIR_QUEUEING_POLICY` names
  another policy
* `adaptive-fast-lane` (`adaptiveFastLanePolicy`, in `adaptive-fast-lane-policy.ts`) -
  [adaptive fast lane fair queueing](#adaptive-fast-lane-fair-queueing-experimental)

The first two select jobs with `getNextJobIds` and split the batch across them the same way (step
5 of [The Algorithm](#the-algorithm)); they differ only in how `getNextJobIds` ranks and filters
the jobs. The adaptive fast lane policy has its own queries, which follow duration based fair
queueing's. The work-scheduler passes the selected policy to `getWorkItemsFromDatabase` along with
the service's pod count and the fast lane reserve settings, which each policy uses as needed.

A policy implements `scheduleWork`: it picks jobs and calls the `takeWorkItems` callback it is
given for each one, which hands out the work items and keeps `user_work` in sync, so a policy
can't leave the bookkeeping inconsistent. To add a policy, implement `FairQueueingPolicy`, add it
to `FAIR_QUEUEING_POLICIES` in `fair-queueing-policy.ts`, and add its name to the values the
work-scheduler accepts for `FAIR_QUEUEING_POLICY` (`services/work-scheduler/app/util/env.ts`).

New policies can be tried out first with the fair queueing simulator in `tools/fair-queueing-sim`,
which runs Harmony's real scheduling and work item update code against simulated services and a
virtual clock, so hours of activity - including services whose work items take hours - can be
simulated in seconds and policies compared side by side with the policies above. See
`tools/fair-queueing-sim/README.md`.
