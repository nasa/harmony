# Environment variable changelog
Any changes to the environment variables will be documented in this file in chronological
order with the most recent changes first.

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
