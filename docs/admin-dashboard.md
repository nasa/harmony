# Admin Dashboard

The admin dashboard (`/admin/dashboard`, admin group only) shows work item and job health,
per-service and per-user usage, and the current queue state. It is built so that viewing it never
puts load on the hot `work_items` and `jobs` tables.

## Where the data comes from

The cron service's work items stats job (`WORK_ITEMS_STATS_CRON`, every minute) aggregates
recently updated work items and finished jobs into per-minute tables, then recomputes the hourly
rollups of the hours it touched (`services/harmony/app/models/work-items-stats.ts`):

| Per-minute table | Hourly rollup | Grouped by | Metrics |
|---|---|---|---|
| `work_items_stats` | `work_items_stats_hourly` | service (image), status | count, durations (count, sum, max, histogram buckets), retries, output size |
| `user_work_items_stats` | `user_work_items_stats_hourly` | user, service, status | count, durations (count, sum, max), retries, output size |
| `work_items_failure_stats` | `work_items_failure_stats_hourly` | service, status (failed or warning), message category | count |
| `job_stats` | `job_stats_hourly` | user, synchronous or not, status (terminal statuses only) | count, durations (sum, max), granules, input and output size |

Each run re-aggregates every minute from one minute before its previous run (the
`work_item_stats_update` row of `run_watermarks`) in a single scan of `work_items` (and one of the
finished jobs), and *replaces* those minutes - so re-aggregating a minute never counts anything
twice. Durations exclude canceled work items and work items without a recorded duration. A work
item's duration histogram bucket is one of `< 1 s, 1-5 s, 5-15 s, 15 s-1 min, 1-5 min, 5-15 min,
15 min-1 h, >= 1 h` (`DURATION_BUCKET_UPPER_BOUNDS_MS`), from which percentiles are estimated.

The same job then deletes expired rows - per-minute rows after `WORK_ITEMS_STATS_MINUTE_RETENTION_DAYS`
(14) and hourly rows after `WORK_ITEMS_STATS_HOURLY_RETENTION_DAYS` (400) - at most
`WORK_ITEMS_STATS_PRUNE_HOURS_PER_RUN` hours of rows per table per run, one hour per statement,
outside of the aggregation transaction.

Live state ("queued now", ready and running work, and the longest wait for new work to be performed
for a job - how long the job that has waited longest has gone without any of its ready work items
being started, not how long any work item has been ready) comes from
the small `user_work` table, and the system queue sizes from SQS. Only two queries read the hot
tables, and both only run when an admin asks for them: the list of the longest running jobs (which
reads only unfinished jobs), and the list of the jobs with work items that reached a status, shown
when a status count or status legend entry is selected. The latter reads `work_items` through its
`("updatedAt", status, "serviceID")` index, is bounded by the statement timeout, and can't find
work items the work reaper has already deleted.

"Retries before success" counts the retry attempts of work items that went on to succeed, and the
share of those work items' attempts that were retries - the same measures as `/admin/retry-stats`,
which the dashboard links to for a breakdown by retry count. "Compute time" is the summed duration
of the completed work items (excluding canceled ones).

"Est. backlog compute" and "Est. time to clear" are shown for the whole system (in "Right now"),
each service and each service's users, and each user and each user's services. The backlog is the
work not started yet - the ready work items.

* The backlog's compute time is computed from `user_work` with the same per-job-and-service duration
  that duration-based fair queueing uses (`EFFECTIVE_DURATION_SQL` in
  `services/harmony/app/models/user-work.ts`): the job's measured average duration for the service,
  or the average of its failures if nothing has succeeded yet, or the duration seeded from the user's
  recent jobs for the service (`USER_WORK_DURATION_SEED_LOOKBACK_DAYS`), or else
  `DEFAULT_EXPECTED_DURATION_MS` (1 hour) - the dashboard marks estimates that include such work
  items with an asterisk.
* The time to clear is the backlog's compute time divided by the recent compute throughput of the
  same service, user, or user and service: the summed duration of the work items completed in the
  last 15 minutes of complete per-minute stats, per unit of time (i.e. the average number of work
  items in progress at once). With a backlog but nothing completed recently it can't be estimated,
  and is shown as "no throughput". It assumes the throughput stays the same - e.g. a user's share
  of a service changes as other users' work comes and goes.
* Only work items that exist count, so the work of a job's later steps (created as earlier steps
  finish) isn't included.

## The API

The page is a client side app (`services/harmony/public/js/dashboard/`) that loads everything from
a JSON API (`services/harmony/app/frontends/dashboard-api.ts`):

| Endpoint | Returns |
|---|---|
| `GET /admin/dashboard/api/summary` | system totals with the previous period for comparison, a time series, the duration histogram, every service's stats and live work, finished job stats, queue sizes, and how long ago the stats were updated |
| `GET /admin/dashboard/api/services/{name}` | a service's totals, time series, histogram, stats by image (version), failure message categories, and users |
| `GET /admin/dashboard/api/users?limit=&filter=&service=&sort=&dir=` | the users with work in the range, with their job stats and live work, ranked by `sort` (a users table column - `username`, `computeMs`, `total`, `failed`, `successRate`, `retries`, `jobs`, `sync`, `async`, `ready`, `backlogCompute`, `backlogClear`, or `running` - default `computeMs` - compute time, the summed work item durations) in `dir` order (default `desc`), then limited to `limit` (default 25, at most 500). `filter` keeps only users whose username contains it (ignoring case), and `service` only users with work for that service, with their work item stats and live work for only that service (their job stats are still for all their jobs) |
| `GET /admin/dashboard/api/users/{username}` | a user's stats by service, time series, job stats, and live work |
| `GET /admin/dashboard/api/jobs/by-work-item-status?status=&service=&user=&limit=` | the jobs with the most work items that reached `status` (`successful`, `failed`, `canceled`, or `warning`) in the range, optionally only for a service and/or user, each with a link to its work items with that status in the workflow UI. Read from `work_items`, whose rows for finished jobs the work reaper deletes after `REAPABLE_WORK_AGE_MINUTES` (14 days), so when the range starts before then `workItemsReapedBefore` gives that cutoff (and the dashboard shows a warning) - otherwise it's `null` |
| `GET /admin/dashboard/api/jobs/running?limit=` | the oldest unfinished jobs, and how many haven't been updated in an hour |

Every endpoint but the last takes either `range` (`1h`, `6h`, `24h` - the default, `7d`, `30d`, or
`90d`) or a custom `start` and `end` (ISO-8601). Ranges of up to a day starting within the
per-minute retention period are read from the per-minute tables, and longer ones from the hourly
rollups. The same goes for the previous period a range is compared with, so it can be read from the
hourly rollups (widened to whole hours) even when the range itself isn't. Responses are cached in memory for `DASHBOARD_CACHE_TTL_MS`, and each request's queries
run in a read only transaction with a `DASHBOARD_QUERY_TIMEOUT_MS` statement timeout.

Like `GET /admin/dashboard`, the API is versioned: every endpoint accepts a `version` query
parameter (currently only `1` is supported, and requesting anything else is a 400 error), uses the
current version when none is given, and includes the `version` in its response. Scripts should
request a version explicitly so they keep getting the same response format. A new version is added
(and the old ones kept) whenever a response format changes incompatibly - adding fields doesn't
need one.

The original `GET /admin/dashboard` JSON response (with `window1`/`window2` parameters) is
unchanged, and has its own version (also `1`). Like the API, a window starting more than
`WORK_ITEMS_STATS_MINUTE_RETENTION_DAYS` ago is read from the hourly rollups (`work_items_stats_hourly`)
instead, widened to whole hours - its `timeRanges` entry gives the range actually summarized.
