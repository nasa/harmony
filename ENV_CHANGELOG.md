# Environment variable changelog
Any changes to the environment variables will be documented in this file in chronological
order with the most recent changes first.

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
