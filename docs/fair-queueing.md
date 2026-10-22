# Fair Queueing <!-- omit in toc -->

**IMPORTANT! This documentation concerns features under active development. The algorithm described here may undergo changes in the future.**

## Table of Contents<!-- omit in toc -->
- [Introduction](#introduction)
- [Background](#background)
- [The Algorithm](#the-algorithm)
- [The Fast Lane Reserve](#the-fast-lane-reserve)

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
The real scheduling path batches work across many jobs and users at once, rather than picking one
user then one job at a time.

When the work-scheduler needs to fill a service's queue (`services/work-scheduler/app/workers/scheduler.ts`),
it works out how many items to request and asks for them in batches of at most
`WORK_ITEM_SCHEDULER_BATCH_SIZE`. For each batch:

1. `getNextJobIds` (`user-work.ts`) identifies all jobs with ready work for the service, subject to
   the [fast lane reserve](#the-fast-lane-reserve) below, and groups them by user
2. For each user, it computes that user's _expected runtime_ of work currently in progress: the
   sum, across all of that user's `(job, service)` rows in `user_work` for every service, of
   `running_count × average_duration` (using a default duration for rows whose `average_duration`
   hasn't been measured yet)
3. Each user's own jobs are ranked with their synchronous jobs ahead of their asynchronous ones,
   then least-to-most-recently-worked; all users' jobs are then interleaved into rounds: round 1 is
   every user's top-ranked job, round 2 is every user's next job, and so on. Within a round, the
   user with the least expected runtime goes first; ties go to whoever was served longest ago
4. The top `batchSize` jobs by that interleaved order are selected and locked with
   `FOR UPDATE ... SKIP LOCKED`, so multiple scheduler pods can't hand out the same work
5. `getWorkItemsFromDatabase` (`work-item-polling.ts`) shuffles the selected jobs (so that any jobs
   left over when the batch doesn't divide evenly aren't always the same ones at the end of the
   list), then gives each job `ceil(remaining batch ÷ remaining jobs)` work items, picking the
   lowest-ID ready items for that job. This shuffle only affects how the batch's items are split
   across the jobs already selected in step 4 - it has no bearing on which jobs made it into the
   batch, or their priority order within it
6. Each returned row's `last_worked` column is updated to indicate work being done for that user
   and job at the current point in time

Steps 1-6 happen inside a single database transaction per batch.

Separately, when a work item later completes, `decrementRunningCount` updates the `average_duration`
and `completed_count` columns for that row with a cumulative mean incorporating the completed work
item's duration - this happens in the work-updater's own transaction, not the scheduling batch above.

This satisfies the first requirement in [Introduction](#introduction): if one user is alone in the
system, every round is that user's job, so they get the whole batch. It also satisfies the second:
round-robin interleaving means no single user can fill a batch, the user with the least work in
flight goes first within a round, and a user's synchronous jobs are always ranked ahead of their
asynchronous ones. Note that synchronous-job priority is scoped to each user's own jobs - it
doesn't let one user's synchronous job jump ahead of another user's earlier round.

## The Fast Lane Reserve

Some services see most work items complete quickly, but occasionally process a request whose work
items run far longer than usual (e.g. a very large or complex granule). Left unchecked, a handful
of users with slow-running work can consume all of a service's pods, starving every other user of
fast-completing work even though those other users would otherwise barely compete for capacity.

To prevent this, Harmony caps how much of each service's capacity (its current running pod count)
slow work may occupy at once, reserving the rest for "fast" work:

* A `(job_id, service_id)` pair - tracked by its row in `user_work` - is classified as **slow** once
  its measured `average_duration` exceeds `SLOW_WORK_THRESHOLD_MS`. It's classified as **fast** if
  its `average_duration` is at or below that threshold, or if no work item for that job and service
  has completed yet (so a new job's duration can be measured without being treated as slow by
  default).
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

This means slow work is only held back when it is already using a large share of the service, so a
service busy with slow work still makes forward progress on fast work, while slow work is never
starved outright.