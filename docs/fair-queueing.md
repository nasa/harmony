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
The steps to perform fair queueing in harmony can be summarized as follows:

When a worker requests a work item for a given service

1. Identify all the users actively requesting work to be done on the service, subject to the
   [fast lane reserve](#the-fast-lane-reserve) below
2. From the list of identified users, determine which user has the least _expected runtime_ of
   work currently in progress, where expected runtime for a user is the sum, across all of that
   user's `(job, service)` rows in `user_work` for every service, of `running_count × average_duration`
   (using a default duration for rows whose `average_duration` hasn't been measured yet)
3. If multiple users have the same expected runtime, choose the user which had work performed (for
   any service) least recently
4. From that user's list of jobs (only those invoking the service, and subject to the fast lane
   reserve), sort the rows in the user_work table by the `is_async` column to favor synchronous
   jobs, then sort by the `last_worked` column to identify the job that has been worked least
   recently - return a work item for that job for the given service with the work item having the
   lowest ID
5. Update the `last_worked` column for that row in the user work table to indicate work being done
   for that user and job at the current point in time
6. When the work item completes, update the `average_duration` and `completed_count` columns for
   that row with a cumulative mean incorporating the completed work item's duration

All of the above are done inside a database transaction with locking to prevent a
work item from being issued more than once.

Note that this implicitly satisfies the first requirement as there will only be one user identified in step 1. Note also that this satisfies the second requirement including prioritizing synchronous calls.

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
  prioritized by exactly the same rules as all other jobs (user expected runtime, sync before
  async, least recently worked). Each scheduling pass hands out at most the remaining slow work
  slots to slow jobs, so a single batch cannot overshoot the capacity.
* Once slow work in flight reaches the slow work capacity, rows measured as slow are skipped even
  though they have ready work, until slow work items complete and free up slots.
* A user or job never-before-measured for a service is still eligible while slow work is blocked,
  as long as it has no other work currently running for that job and service - this is what lets
  Harmony measure a new job's duration rather than permanently assuming the worst about it.

This means slow work is only held back when it is already using a large share of the service, so a
service busy with slow work still makes forward progress on fast work, while slow work is never
starved outright.