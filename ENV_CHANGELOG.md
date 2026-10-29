# Environment variable changelog
Any changes to the environment variables will be documented in this file in chronological
order with the most recent changes first.

## 2026-10-28
### Changed
- REAPABLE_WORK_AGE_MINUTES - moved from `services/cron-service/env-defaults` to the shared
  `packages/util/env-defaults` (default unchanged, 20160), because the admin dashboard (harmony)
  now uses it to warn when the jobs listed by work item status may be missing reaped work items.

## 2026-10-27
### Added
- WORK_ITEMS_STATS_MINUTE_RETENTION_DAYS - (shared, `packages/util/env-defaults`) how many days of
  per-minute rows the admin dashboard stats tables keep (default 14). The cron service deletes older
  ones, and the dashboard reads the hourly rollups for ranges starting earlier than this. The
  legacy `GET /admin/dashboard` JSON response does the same for its windows.
- WORK_ITEMS_STATS_HOURLY_RETENTION_DAYS - cron service: how many days of hourly rollup rows the
  admin dashboard stats tables keep (default 400).
- WORK_ITEMS_STATS_PRUNE_HOURS_PER_RUN - cron service: the maximum number of hours of expired rows
  deleted from each dashboard stats table per run of the work items stats cron, one hour per
  statement (default 6), so a large backlog is deleted gradually.
- DASHBOARD_CACHE_TTL_MS - harmony: how long admin dashboard API responses are cached in memory
  (default 30000). 0 disables the cache.
- DASHBOARD_QUERY_TIMEOUT_MS - harmony: the Postgres statement timeout for admin dashboard API
  queries (default 15000).
- USER_WORK_DURATION_SEED_LOOKBACK_DAYS - (shared, `packages/util/env-defaults`) how many days of a
  user's `user_work_history` to average when seeding the `average_duration` of a new or resumed
  job's `user_work` rows for a service, so duration based fair queueing can classify the job before
  any of its own work items complete (default 7, 0 disables seeding). Only the user's 100 most
  recent jobs for the service are averaged. Has no effect on slot based fair queueing.
- USER_WORK_HISTORY_REAPER_CRON - cron service schedule for deleting old `user_work_history` rows
  (default hourly).
- USER_WORK_HISTORY_RETENTION_DAYS - `user_work_history` rows for finished jobs last written more
  than this many days ago are deleted from Postgres (default 30). They remain in Iceberg. Should be
  at least USER_WORK_DURATION_SEED_LOOKBACK_DAYS.
- USER_WORK_HISTORY_REAPER_BATCH_SIZE - the maximum number of `user_work_history` rows the reaper
  deletes per statement (default 5000).

## 2026-10-26
### Added
- `VARIABLE_FAN_OUT_*` default variables added to support image and queues.
- `VARIABLE_FAN_OUT_ENABLED` Added as a control to allow bypassing of the fan
   out service when running local Harmony-In-A-Box.  If you are not actively
   developing the fan out service you probably don't want to run fan out or you
   will have to download a file for every variable processed.

## 2026-10-23
### Added
- ENABLE_DURATION_BASED_FAIR_QUEUEING - work-scheduler feature toggle (default false). When false,
  fair queueing is slot based (users ranked by number of running work items, no fast lane reserve)
  and SLOW_WORK_THRESHOLD_MS and FAST_LANE_RESERVE_FRACTION are ignored. When true, users are ranked
  by the expected runtime of their running work and the fast lane reserve is enforced. See
  `docs/fair-queueing.md`.

## 2026-10-22
### Changed
- QUEUE_LONG_POLLING_WAIT_TIME_SEC - lowered default from 20 to 3. A FIFO queue's internal
  partitioning (used here because each work item is sent with its own unique MessageGroupId) means
  an open long poll can miss a message that becomes visible on a different partition mid-wait,
  forcing a wait of up to the full timeout before the next poll picks it up. Lowering the wait
  shrinks that worst case, at the cost of more frequent ReceiveMessage calls while a queue is
  starved - still well under SQS FIFO's 300 req/sec per-queue cap at observed pod counts.

## 2026-10-21
### Added
- SLOW_WORK_THRESHOLD_MS - average work item duration (in ms), per job and service, above which a
  job and service's work items are classified as "slow" for fair queueing's fast lane reserve.
  Only used when ENABLE_DURATION_BASED_FAIR_QUEUEING is true.
- FAST_LANE_RESERVE_FRACTION - fraction of a service's running pod count reserved for "fast" work
  (default 0.3). Slow work is only blocked once running slow work items occupy the remaining
  capacity. Only used when ENABLE_DURATION_BASED_FAIR_QUEUEING is true. See `docs/fair-queueing.md`.

## 2026-10-15
### Added
- ANALYTICS_UPDATE_PAGE_SIZE - the number of rows read from Postgres at a time while building each batch
  during Iceberg propagation

### Changed
- ANALYTICS_UPDATE_BATCH_SIZE - Reduced from 100000 to 25000. DuckDB's memory use for each batch's
  MERGE grows with the batch size, and 100000-row batches got the cron service OOM killed.
- ANALYTICS_UPDATE_MEMORY_LIMIT - Reduced from 2GB to 1GB. This only limits DuckDB's buffer manager, so
  its actual memory use runs higher, and it shares the container's memory with Node - it must stay well
  under CRON_SERVICE_LIMITS_MEMORY to avoid the container being OOM killed.

## 2026-10-01
### Changed
- HYBIG_LIMITS_MEMORY - Increased to 12Gi to handle large polar-projected granules in NISAR collections.

## 2026-09-29
### Added
- DEDUPE_THRESHOLD - requests with more than this many input granules are checked for an identical
  earlier request by the same user, and return that job instead of starting a new one.
- DEDUPE_MAX_AGE_DAYS - how many days after creation a completed job may still be returned for a
  duplicate request. Capped at 7 so a returned job's output is still available.

## 2026-09-04
### Added
- MAX_BULK_JOB_STATUS_IDS - controls the maximum number of job IDs that can be requested at once
  from the bulk job status endpoint (`POST /jobs/status`).

## 2026-07-07
### Changed
- HARMONY\_REGRIDDER\_LIMITS\_MEMORY - Increased to 16Gi to prevent out-of-memory errors.

## 2026-02-18
### Added
- DB_USE_SSL - controls whether communication between harmony applications and Postgres is encrypted.

## 2025-10-28
### Changed
- `TRAJECTORY_SUBSETTER_IMAGE` environment variable has been updated to point to
  Docker images hosted in the GitHub Container Registry, following the
  open-source migration of the Trajectory Subsetter service.
- `TRAJECTORY_SUBSETTER_SERVICE_QUEUE_URLS` environment variable has also been
  updated to account for migration to GitHub Container Registry hosted images.

## 2025-10-23
### Changed
- OPERA_RTC_S1_BROWSE_LIMITS_MEMORY - Increased to 2Gi to fix out-of-memory issues.

## 2025-10-14
### Changed
- `SDS_MASKFILL_...` environment variables have been updated to `MASKFILL_...`
  names, and the values have been updated to point to Docker images hosted in
  the GitHub Container Registry, following the open-source migration of the
  MaskFill service. The service name has also been updated from "sds/maskfill"
  to "maskfill".

## 2025-09-18
### Changed
- NET2COG_LIMITS_MEMORY - Increased to 8Gi to accommodate large MODIS v.7 granules.

# 2025-07-30
### Added
- PUBLISH_SERVICE_FAILURE_METRICS_CRON - cron schedule for the job that writes cloudwatch metrics for service failures
- FAILURE_METRICS_LOOK_BACK_MINUTES - how far back to go when computing cloudwatch metrics for service failures

# 2025-07-24
### Added
- MAX_PERCENT_ERRORS_FOR_JOB - the maximum percentage of failures for a service before failing a job
- MIN_DONE_ITEMS_FOR_FAIL_CHECK - the minimum number of complete work-items for a service before the failure percentage is checked

# 2025-05-19
### Added
- Added environment defaults for Harmony Metadata Annotator

# 2025-05-16
### Removed

- All Harmony NetCDF-to-Zarr related environment variables as part of deprecating that service:
  - HARMONY_NETCDF_TO_ZARR_IMAGE
  - HARMONY_NETCDF_TO_ZARR_REQUEST_CPU
  - HARMONY_NETCDF_TO_ZARR_REQUEST_MEMORY
  - HARMONY_NETCDF_TO_ZARR_LIMITS_CPU
  - HARMONY_NETCDF_TO_ZARR_LIMITS_MEMORY
  - HARMONY_NETCDF_TO_ZARR_INVOCATION_ARGS
  - HARMONY_NETCDF_TO_ZARR_SERVICE_QUEUE_URLS

# 2024-12-04
### Added
- USE_EDL_CLIENT_APP - whether to use an EDL client application to enable admin and deployment endpoints and allow OAuth workflows.
- EDL_TOKEN - required if USE_EDL_CLIENT_APP is set to false. An EDL token to use for all requests to the CMR and to download data in backend services.

### Changed
- OAUTH_CLIENT_ID, OAUTH_UID, OAUTH_PASSWORD, and OAUTH_REDIRECT_URI are no longer required if USE_EDL_CLIENT_APP is false.

# 2024-12-03
### Added
- Added enviroment defaults for Harmony SMAP L2 Gridding Service

# 2024-11-05
### Added
- LABEL_FILTER_COMPLETION_COUNT - the max number of labels to retrieve to populate label filter auto-complete

# 2024-10-23
### Added
- LABELS_ALLOW_LIST - comma-separated list of values that are explicitly allowed for labels
- LABELS_FORBID_LIST - comma-separated list of values that are explicitly forbidden for labels

## 2024-08-30
### Added
- Added environment defaults for NET2COG service

## 2024-07-31
### Changed
- HYBIG\_INVOCATION\_ARGS changed to call new `harmony_service` package to support V2 HyBIG.

## 2024-04-25
### Changed
- HARMONY_REGRIDDER_IMAGE - Updated to point to ghcr.io hosted image.
- HARMONY_REGRIDDER_SERVICE_QUEUE_URLS - Updates to point to ghcr.io image.

## 2024-02-19
### Changed
- TRAJECTORY_SUBSETTER_LIMITS_MEMORY - Increased to 8Gi to accommodate large GEDI L1B files.


## 2024-01-23
### Changed
- HYBIG_IMAGE to point to ghcr.io hosted image.
- HYBIG_SERVICE_QUEUE_URLS to point to ghcr.io hosted image.

## 2024-01-04
### Changed
- SWOT_REPROJECT_IMAGE to SWATH_PROJECTOR_IMAGE
- SWOT_REPROJECT_REQUESTS_CPU to SWATH_PROJECTOR_REQUESTS_CPU
- SWOT_REPROJECT_REQUESTS_MEMORY to SWATH_PROJECTOR_REQUESTS_MEMORY
- SWOT_REPROJECT_LIMITS_CPU to SWATH_PROJECTOR_LIMITS_CPU
- SWOT_REPROJECT_LIMITS_MEMORY to SWATH_PROJECTOR_LIMITS_MEMORY
- SWOT_REPROJECT_INVOCATION_ARGS to SWATH_PROJECTOR_INVOCATION_ARGS
- SWOT_REPROJECT_SERVICE_QUEUE_URLS to SWATH_PROJECTOR_SERVICE_QUEUE_URLS
- SWATH_PROJECTOR_IMAGE to point to ghcr.io hosted image.
- SWATH_PROJECTOR_INVOCATION_ARGS to use new image entry point.
- SWATH_PROJECTOR_SERVICE_QUEUE_URLS to change references from "swot-reproject" to "swath-projector".

## 2024-01-03
### Changed
- HOSS_LIMITS_MEMORY - Increased to 8Gi to accommodate filling for bounding boxes crossing grid edge for large granules.

## 2024-01-03
### Changed
- MAX_DOWNLOAD_RETRIES - Decreased to 3.

## 2023-10-09
### Changed
- VAR_SUBSETTER_IMAGE to HOSS_IMAGE
- VAR_SUBSETTER_REQUESTS_CPU to HOSS_REQUESTS_CPU
- VAR_SUBSETTER_REQUESTS_MEMORY to HOSS_REQUESTS_MEMORY
- VAR_SUBSETTER_LIMITS_CPU to HOSS_LIMITS_CPU
- VAR_SUBSETTER_LIMITS_MEMORY to HOSS_LIMITS_MEMORY
- VAR_SUBSETTER_INVOCATION_ARGS to HOSS_INVOCATION_ARGS
- VAR_SUBSETTER_SERVICE_QUEUE_URLS to HOSS_SERVICE_QUEUE_URLS
- HOSS_IMAGE to point to ghcr.io hosted image.
- HOSS_INVOCATION_ARGS to use new image entry point.
- HOSS_SERVICE_QUEUE_URLS to change references from "var-subsetter" to "hoss".

## 2023-08-11
### Changed
Split env-defaults into separate files based on use

## 2022-12-15
### Changes
- HARMONY_NETCDF_TO_ZARR_IMAGE - Update to point to ghcr.io hosted images.
## 2022-11-04
### Added
- MAX_BATCH_INPUTS - Upper limit on the number of files that can go into an aggregation batch
- MAX_BATCH_SIZE_IN_BYTES - Upper limit on the total number of bytes in all the files going into an aggregation batch

## 2022-06-03
### Added
- MAX_PUT_WORK_RETRIES - how many times a manager should retry a retryable PUT /work request

## 2022-06-01
### Added
- MAX_DOWNLOAD_RETRIES - Number of times to retry failed HTTP (408, 502, 503, 504) data downloads in the the service library.

## 2022-03-07
### Changed
- ASF_GDAL_SUBSETTER_IMAGE to HARMONY_GDAL_ADAPTER_IMAGE

## 2020-12-02
### Added
- CMR_MAX_PAGE_SIZE - page_size parameter to use for CMR requests
## 2020-11-20
### Added
- CMR_GRANULE_LOCATOR_IMAGE - New image for issuing queries to the CMR to identify granules for a request
- CMR_GRANULE_LOCATOR_IMAGE_PULL_POLICY - Pull policy for the new granule locator image

### Changed
- ASF_GDAL_IMAGE to ASF_GDAL_SUBSETTER_IMAGE
- ASF_GDAL_IMAGE_PULL_POLICY to ASF_GDAL_SUBSETTER_IMAGE_PULL_POLICY
- ASF_GDAL_PARALLELLISM to ASF_GDAL_SUBSETTER_PARALLELISM
- GDAL_IMAGE to HARMONY_GDAL_IMAGE
- GDAL_IMAGE_PULL_POLICY to HARMONY_GDAL_IMAGE_PULL_POLICY
- GDAL_PARALLELLISM to HARMONY_GDAL_PARALLELISM
- NETCDF_TO_ZARR_IMAGE to HARMONY_NETCDF_TO_ZARR_IMAGE
- NETCDF_TO_ZARR_IMAGE_PULL_POLICY to HARMONY_NETCDF_TO_ZARR_IMAGE_PULL_POLICY
- NETCDF_TO_ZARR_PARALLELLISM to HARMONY_NETCDF_TO_ZARR_PARALLELISM
- SWOT_REPR_IMAGE to SWOT_REPROJECT_IMAGE
- SWOT_REPR_IMAGE_PULL_POLICY to SWOT_REPROJECT_IMAGE_PULL_POLICY
- SWOT_REPR_PARALLELLISM to SWOT_REPROJECT_PARALLELISM

## 2022-01-19

### Removed
- All environment variable configuration related to Argo (ARGO_URL, IMAGE_PULL_POLICY vars, PARALLELISM vars)

### Changed
- DEFAULT_ARGO_TIMEOUT_SECS to DEFAULT_POD_GRACE_PERIOD_SECS
