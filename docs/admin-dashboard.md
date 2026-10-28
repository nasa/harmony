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

Live state ("queued now", ready and running work, and the longest wait for ready work) comes from
the small `user_work` table, and the system queue sizes from SQS. The list of the longest running
jobs is the only query of `jobs`, reads only unfinished jobs, and only runs when an admin asks for it.

## The API

The page is a client side app (`services/harmony/public/js/dashboard/`) that loads everything from
a JSON API (`services/harmony/app/frontends/dashboard-api.ts`):

| Endpoint | Returns |
|---|---|
| `GET /admin/dashboard/api/summary` | system totals with the previous period for comparison, a time series, the duration histogram, every service's stats and live work, finished job stats, queue sizes, and how long ago the stats were updated |
| `GET /admin/dashboard/api/services/{name}` | a service's totals, time series, histogram, stats by image (version), failure message categories, and users |
| `GET /admin/dashboard/api/users?limit=` | the users with the most compute time (summed work item durations), with their job stats and live work |
| `GET /admin/dashboard/api/users/{username}` | a user's stats by service, time series, job stats, and live work |
| `GET /admin/dashboard/api/jobs/running?limit=` | the oldest unfinished jobs, and how many haven't been updated in an hour |

Every endpoint but the last takes either `range` (`1h`, `6h`, `24h` - the default, `7d`, `30d`, or
`90d`) or a custom `start` and `end` (ISO-8601). Ranges of up to a day starting within the
per-minute retention period are read from the per-minute tables, and longer ones from the hourly
rollups. Responses are cached in memory for `DASHBOARD_CACHE_TTL_MS`, and each request's queries
run in a read only transaction with a `DASHBOARD_QUERY_TIMEOUT_MS` statement timeout.

Like `GET /admin/dashboard`, the API is versioned: every endpoint accepts a `version` query
parameter (currently only `1` is supported, and requesting anything else is a 400 error), uses the
current version when none is given, and includes the `version` in its response. Scripts should
request a version explicitly so they keep getting the same response format. A new version is added
(and the old ones kept) whenever a response format changes incompatibly - adding fields doesn't
need one.

The original `GET /admin/dashboard` JSON response (with `window1`/`window2` parameters) is
unchanged, and has its own version (also `1`).
