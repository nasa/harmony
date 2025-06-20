# Adapting New Services to Harmony<!-- omit in toc -->

If you're adapting a new service for Harmony, we recommend reaching out in the `#harmony-service-providers` channel on EOSDIS Slack for help and to share any feedback that can improve this process for others.

### Note on `services.yml`
Harmony services are configured differently depending on the environment:
- Services deployed in the Harmony UAT environment are defined in `config/services-uat.yml`.
- Services deployed in the Harmony production environment are defined in `config/services-prod.yml`.

This guide refers to both of these files collectively as `services.yml`.

## Quick Start
Setting up a new service can feel daunting at first. To simplify the process, Harmony provides a scaffolding script:
```bash
bin/generate-new-service
```
This script sets up the essential files and configuration needed to integrate a service into the local Harmony development environment. Specifically, it will:

1. Add necessary environment variables to the appropriate `env-defaults` files.
2. Create a new service definition in `services-uat.yml`.
3. Update your local `.env` file (e.g. LOCALLY_DEPLOYED_SERVICES) to ensure the new service is included in your development setup.
4. Add overrides in `.env` to allow testing without requiring a UMM-S record or associated collections in UAT.
5. Generate a new service directory (at the same level as the Harmony repo) that includes:
   - A `Dockerfile` with common dependencies for Harmony services
   - A script to build the service's Docker image
   - A Python wrapper integrating the `harmony-service-library`, with placeholders for your custom service logic

### Setting up a new service
***Prior to setting up a new service be sure to get harmony fully functional and tested with harmony-service-example by following the Quickstart
in the main [README](../../README.md). Then come back to this section to set up the new service.***

1. Run `bin/generate-new-service` and respond to the prompts.
2. Follow the post-script instructions printed to your terminal to complete the setup.
3. Ensure your service is listed in `LOCALLY_DEPLOYED_SERVICES` in `.env` to enable local deployment.

Using the script will help to highlight the files that need to be changed in order to test with harmony and many of the defaults will just work.
Once you have finished testing things out, be sure to follow the steps outlined in the rest of this document to ensure the service is
ready to be integrated into other harmony test environments.

Note that the service chain that is generated in `services-uat.yml` will define a service chain that queries for granules from the CMR and
then invokes a single service image. If your service requires a more complex processing chain, be sure to adjust the configuration accordingly.

## Table of Contents<!-- omit in toc -->
- [Requirements for Harmony Services](#requirements-for-harmony-services)
  - [1. Allowing Harmony to invoke services](#1-allowing-harmony-to-invoke-services)
  - [2. Accepting Harmony requests](#2-accepting-harmony-requests)
  - [3. Sending results to Harmony](#3-sending-results-to-harmony)
  - [4. Canceled requests](#4-canceled-requests)
  - [5. Error handling](#5-error-handling)
  - [6. Defining environment variables in env-defaults](#6-defining-environment-variables-in-env-defaults)
  - [7. Registering services in services-uat.yml](#7-registering-services-in-services-uatyml)
    - [Sequential Steps](#sequential-steps)
    - [Aggregation Steps](#aggregation-steps)
  - [8. Docker Container Images](#8-docker-container-images)
  - [9. Recommendations for service implementations](#9-recommendations-for-service-implementations)
  - [10. Service chaining](#10-service-chaining)



# Requirements for Harmony Services
In order for a service to run in Harmony, several things need to be provided as covered in the following sections. For examples of Harmony services and development guidance, see [Examples and Guidance](https://github.com/nasa/harmony-service-lib-py/blob/main/README.md#examples-and-guidance).

## 1. Allowing Harmony to invoke services

Harmony provides a Python library, [harmony-service-lib-py](https://github.com/nasa/harmony-service-lib-py), to ease the process of adapting Harmony messages to service code. It provides helpers for message parsing, command line interactions, data staging, reading and writing STAC catalogs, and Harmony callbacks. Full details as well as an example can be found in the project's README and code. *This is the preferred way for services to interact with Harmony as it handles much of the work for the service and makes it easy for services to stay up-to-date with Harmony.*

## 2. Accepting Harmony requests

When invoking a service, Harmony provides an input detailing the specific operations the service should perform and a STAC catalog detailing the URLs of the data it should perform the operations on. See the latest [Harmony data-operation schema](../../services/harmony/app/schemas/data-operation) for details on Harmony's operation input JSON format. Harmony invokes the service running in Kubernetes via [Harmony Service CLI](https://github.com/nasa/harmony-service-lib-py/blob/main/README.md#where-it-fits-in). Each new service will need to adapt this Harmony Service CLI command-line invocation into an actual service invocation, typically transforming the JSON input and source data into method calls, command-line invocations, or HTTP requests to generate the service output.

Ideally, this adaptation would consist only of necessary complexity peculiar to the service in question. Please let the team know if there are components that can make this process easier and consider sending a pull request or publishing your code if you believe it can help future services.

## 3. Sending results to Harmony

This is handled automatically by the service library using the output of the service invocation.

## 4. Canceled requests

Canceled requests are handled internally by Harmony. Harmony will prevent further work from being sent to a service on behalf of a canceled request, but will not otherwise interact with a service that is already processing data on behalf of a request. For services employing the service library nothing needs to be done to support request cancellation.

## 5. Error handling

For unrecoverable conditions, services should raise exception to trigger a failure. The exception message will be forwarded to Harmony and visible to end users through the job status endpoint (`/jobs/<job-id>`). See [Error Handling](https://github.com/nasa/harmony-service-lib-py/blob/main/README.md#error-handling) for detailed error handling guidance when using the preferred harmony-service-lib-py for service development.

## 6. Defining environment variables in env-defaults

Add environment variables specific to the service to [env-defaults](../../services/harmony/env-defaults). See the harmony-service-example for an example of the environment variables needed:

```
HARMONY_SERVICE_EXAMPLE_IMAGE=harmonyservices/service-example:latest
HARMONY_SERVICE_EXAMPLE_REQUESTS_CPU=128m
HARMONY_SERVICE_EXAMPLE_REQUESTS_MEMORY=128Mi
HARMONY_SERVICE_EXAMPLE_LIMITS_CPU=128m
HARMONY_SERVICE_EXAMPLE_LIMITS_MEMORY=512Mi
HARMONY_SERVICE_EXAMPLE_INVOCATION_ARGS='python -m harmony_service_example'
```

**Important** Be sure to prefix the entries with the name of your service. Set the value for the `INVOCATION_ARGS` environment variable. This should be how you would run your service from the command line. For example, if you had a python module named `my-service` in the working directory, then you would run the service using:
  ```bash
  python -m my-service
  ```
  So your entry for `INVOCATION_ARGS` would be
  ```shell
  MY_SERVICE_INVOCATION_ARGS='python -m my-service'
  ```

## 7. Registering services in services-uat.yml

Add an entry to [services-uat.yml](../../config/services-uat.yml) that has umm-s appropriate to the service and send a pull request to the Harmony team, or ask a Harmony team member for assistance. It is important to note that the order that service entries are placed in this file can have an impact on service selection. In cases where multiple services are capable of performing the requested transformations, the service that appears first in the file will handle the request.

The structure of an entry in the [services-uat.yml](../../config/services-uat.yml) file is as follows:

```yaml
- name: harmony/service-example    # A unique identifier string for the service, conventionally <team>/<service>
  data_operation_version: '0.22.0' # The version of the data-operation messaging schema to use
  has_granule_limit: true          # Optional flag indicating whether we will impose granule limits for the request. Default to true.
  default_sync: false              # Optional flag indicating whether we will force the request to run synchronously. Default to false.
  type:                            # Configuration for service invocation
      <<: *default-turbo-config    # To reduce boilerplate, services-uat.yml includes default configuration suitable for all Docker based services.
      params:
        <<: *default-turbo-params  # Always include the default parameters for docker services
        env:
          <<: *default-turbo-env   # Always include the default docker environment variables and then add service specific env
          STAGING_PATH: public/harmony/service-example # The S3 prefix where artifacts generated by the service will be stored
  umm_s: S1234-EXAMPLE            # Service concept id for the service. It is a required field and must be a string.
  collections:                    # Optional, should not exist in most cases. It is only used when there are granule_limit or variables applied to collections of the service.
    - id: C1234-EXAMPLE
      granule_limit: 1000         # A limit on the number of granules that can be processed for the collection (OPTIONAL - defaults to no limit)
      variables:                  # A list of variables provided by the collection (OPTIONAL)
        - v1
        - v2
  maximum_sync_granules: 1        # Optional limit for the maximum number of granules for a request to be handled synchronously. Defaults to 1. Set to 0 to only allow async requests.
  capabilities:                   # Service capabilities
    subsetting:
      bbox: true                  # Can subset by spatial bounding box
      temporal: true              # Can subset by a time range
      variable: true              # Can subset by UMM-Var variable
      multiple_variable: true     # Can subset multiple variables at once
    averaging:
      time: true                  # Can perform averaging over time
      area: true                  # Can perform averaging over area
    output_formats:               # A list of output mime types the service can produce
      - image/tiff
      - image/png
      - image/gif
    reprojection: true            # The service supports reprojection
  validate_variables: true        # Whether to validate the requested variables exist in the CMR. Defaults to true.
  external_validation_url: http://example.com # Optional endpoint to be called to validate the user making a request
  steps:
      - image: !Env ${QUERY_CMR_IMAGE} # The image to use for the first step in the chain
        is_sequential: true       # Required for query-cmr
      - image: !Env ${HARMONY_EXAMPLE_IMAGE}     # The image to use for the second step in the chain
```

Each harmony service must have one and only one `umm-s` concept-id configured via the `umm-s` field in services-uat.yml. Collections on which a service works are specified via [creating a UMM-S/UMM-C association](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html#service-association) in the CMR with the configured umm-s concept.  See [this wiki link](https://wiki.earthdata.nasa.gov/display/HARMONY/UMM-S+Guidance+for+Harmony+Services) and the [Service Configuration](./configuring-harmony-service.ipynb) notebook for further UMM-S guidance with respect to Earthdata Search.

**NOTE:** `collections` field can only have value when `granule_limit` or `variables` need to be configured for specific collections for the service.

If you intend for Harmony job results that include this collection to be shareable, make sure that guests have `read` permission on the collection (via [CMR ACLs endpoints](https://cmr.earthdata.nasa.gov/access-control/site/docs/access-control/api.html)), and if no EULAs are present that the `harmony.has-eula` tag is associated with the collection and set to `false` via the CMR `/search/tags/harmony.has-eula/associations` endpoint. Example request body: `[{"concept_id": "C1233860183-EEDTEST", "data": false}]`. All collections used in the Harmony job must meet these two requirements in order for the job to be shareable.

The last part of this entry defines the workflow for this service consisting of the query-cmr service (CMR_GRANULE_LOCATOR_IMAGE) followed by the docker_example service (DOCKER_EXAMPLE_IMAGE). For single service (excluding query-cmr) workflows, one need only list the steps. For more complicated workflows involving chained services (once again not counting the query-cmr service) one can list the operations each service in the chain provides along with a list of conditions under which the service will be invoked.

The following `steps` entry is for a chain of services including the PODAAC L2 Subsetter followed by the PODAAC Concise service:

```yaml
steps:
  - image: !Env ${QUERY_CMR_IMAGE}
    is_sequential: true
  - image: !Env ${PODAAC_L2_SUBSETTER_IMAGE}
    operations: ['spatialSubset', 'variableSubset', 'temporalSubset']
    conditional:
      exists: ['spatialSubset', 'variableSubset', 'temporalSubset']
  - image: !Env ${PODAAC_CONCISE_IMAGE}
    always_wait_for_prior_step: true
    is_batched: true
    operations: ['concatenate']
    conditional:
      exists: ['concatenate']
```

First we have the query-cmr service (this service is the first in every current workflow). This is followed by the PODAAC L2 Subsetter service, which provides the 'spatialSubset', 'variableSubset' and 'temporalSubset' operations and is only invoked if the user is requesting at least one of those operations. Finally, we have the PODAAC Concise service which provides the 'concatenate' operation and is only invoked if the request asks for that operation.

There is also a `conditional` option on `umm-c` `native_format` that compares with the value of the collection UMM-C field: `ArchiveAndDistributionInformationType.FileArchiveInformation.Format` when the sibling FormatType = 'Native'. Here is an example of its usage:

```yaml
steps:
  - image: !Env ${QUERY_CMR_IMAGE}
    is_sequential: true
  - image: !Env ${NET_2_COG_IMAGE}
    conditional:
      umm_c:
        native_format: ['netcdf-4']
  - image: !Env ${HYBIG_IMAGE}
```

Here we have the query-cmr service (this service is the first in every current workflow). This is followed by the optional NetCDF to COG service, which will only be invoked when the collection's UMM-C native format is one of the values that are defined (case insensitive) in the steps configuration (i.e. `[netcdf-4]`). Finally, we have the HyBIG service that converts the GeoTIFF inputs from the previous step to Global Imagery Browse Services (GIBS) compatible PNG or JPEG outputs. See [10. Service chaining](#10-service-chaining) for more info.

### Sequential Steps
Most steps will produce all of the pieces of work (known as work-items) for a service immediately when the step begins. This allows all of the work-items to be worked in parallel. It is possible, however, for new work-items for the same service to be produced as the step is being worked. In this case, the work-items must be worked sequentially. Steps that must be worked sequentially should include `is_sequential: true` in their definition.

An example of this is the query-cmr service. Each invocation of the query-cmr service can only return up to 2000 granules (due to the CMR page size limit), so, if the job has more granules than that, query-cmr is invoked multiple times. This must be done sequentially due to the way the CMR uses a scroll ID for paging.

For most services `is_sequential: true` is not necessary.

### Aggregation Steps
Services that provide aggregation, e.g., concatenation for CONCISE, require that all inputs are available when they are run. There are cases when a service can concatenate, but based on the user request will instead work on one granule at a time. For aggregation services that should always wait for the prior step inputs set `always_wait_for_prior_step` to true. Otherwise harmony will infer whether to wait based on the `operations` field in the associated step and whether the user requested some type of aggregation.
The currently supported aggregation operations are `concatenate` and `extend`.

There are limits to the number of files an aggregating service can process as well as the total number
of bytes of all combined input files. To support larger aggregations Harmony can partition the output
files from one service into batches to be passed to multiple invocations of the next (aggregating)
step. Whether or not a service should have its input batched, the maximum number of input files
to include in each batch, and total combined file sizes to allow can be set in the aggregating
service's step definition using the `is_batched`, `max_batch_inputs`, and
`max_batch_size_in_bytes` fields.

The following `steps` entry is an example one might use for an aggregating service:

```yaml
steps:
  - image: !Env ${QUERY_CMR_IMAGE}
    is_sequential: true
  - image: !Env ${EXAMPLE_AGGREGATING_SERVICE_IMAGE}
    always_wait_for_prior_step: true
    is_batched: true
    max_batch_inputs: 100
    max_batch_size_in_bytes: 2000000000
    operations: ['concatenate']
```

There are default limits set by the environment variables `MAX_BATCH_INPUTS` and
`MAX_BATCH_SIZE_IN_BYTES`. Providers should consult the [env-defaults.ts](../../services/harmony/env-defaults) file to obtain the
current values of these variables.

The settings in `services-uat.yml` take precedence over these environment variables. If a provider
wishes to use larger values (particularly for `max_batch_size_in_bytes`) that provider should
contact the Harmony team first to make sure that the underlying Kubernetes pods have enough
resources allocated (disk space, memory).


## 8. Docker Container Images
The service and all necessary code and dependencies to allow it to run should be packaged in a Docker container image. Docker images can be staged anywhere Harmony can reach them, e.g. ghcr.io, Dockerhub or AWS ECR. If the image cannot be made publicly available, contact the harmony team to determine how to provide access to the image.

Harmony will run the Docker image through its entrypoint according to the [Harmony Service CLI](https://github.com/nasa/harmony-service-lib-py/blob/main/README.md#where-it-fits-in).

The `Dockerfile` in the harmony-service-example project serves as a minimal example of how to set up Docker to accept these inputs using the `ENTRYPOINT` declaration.

In addition to the defined command-line parameters, Harmony can provide the Docker container with environment variables as set in [services-uat.yml](../../config/services-uat.yml) by setting `service.type.params.env` key/value pairs. See the existing services-uat.yml for examples.

## 9. Recommendations for service implementations

Note that several of the following are under active discussion and we encourage participation in that discussion.

In order to improve user experience, metrics gathering, and to allow compatibility with future development, Harmony strongly encourages service implementations to do the following:

1. Provide provenance information in output files in a manner appropriate to the file format and following EOSDIS guidelines, such that a user can recreate the output file that was generated through Harmony. The following fields are recommended to include in each output file. Note that the current software citation fields include backend service information; information on Harmony workflow is forthcoming. For NetCDF outputs, information specific to the backend service should be added to the `history` global attribute, with all other fields added as additional global attributes. For GeoTIFF outputs, these fields can be included under `metadata` as `TIFFTAG_SOFTWARE`. See the [NASA ESDS Data Product Development Guide for Data Producers](https://www.earthdata.nasa.gov/esdis/esco/standards-and-practices/data-product-development-guide-for-data-producers) for more guidance on provenance information.

| Field Name               | Field Example                                                                                                                                            | Field Source                         |
|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------|
| Service Title            | podaac-subsetter                                                                                                                                         | UMM-S Long Name                      |
| Service Version          | v1.0.0                                                                                                                                                   | UMM-S Version                        |
| Service Publisher        | NASA Physical Oceanography Distributed Active Archive Center                                                                                             | UMM-S Service Organization Long Name |
| Access Date              | 2020-08-26 00:00:00                                                                                                                                      | Time stamp of file generation        |
| Input granule identifier | SMAP_L3_SM_P_E_20200824_R16515_001                                                                                                                       | Filename of input granule            |
| File request source      | https://harmony.uat.earthdata.nasa.gov/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?subset=lat(-5:5)&subset=lon(-10:10) | Harmony request                      |

2. Preserve existing file metadata where appropriate. This includes file-level metadata that has not changed, layer metadata, and particularly provenance metadata that may have been generated by prior transformations.
3. Log request callback URLs, which serve as unique identifiers, as well as Earthdata Login usernames when available to aid in tracing requests and debugging.
4. Proactively protect (non-Docker) service endpoints from high request volume or computational requirements by using autoscaling with maximum thresholds, queueing, and other methods to avoid outages or non-responsiveness.
5. Use the latest available data-operation schema. As harmony development continues the schema will evolve to support new features, which will require services be compatible with the new schema in order to take advantage of those features. In addition code to support older versions of the schema can be retired once all services have updated to later versions of the schema.
6. Name files according to the [established conventions](https://wiki.earthdata.nasa.gov/pages/viewpage.action?spaceKey=HARMONY&title=Output+File+Naming+Convention).
Using the Harmony-provided Python library makes this automatic for cases where the file corresponds to a single granule. Files subset to a single variable should be
suffixed with underscore followed by the variable name. Files that have been regridded should be suffixed with `_regridded`. Files that have been subsetted should
be suffixed with `_subsetted`. Finally, files should have the conventional file extension according to their format, e.g. `.zarr`.
7. The `stagingLocation` property of the Harmony message contains a prefix of a recommended place to stage your output. If your service is running in the Harmony
account or has access to the Harmony staging bucket, we recommend you place results under that location, as it will allow users to access your data via the S3 API
and ensure correct retention policies and access logging as features are added to Harmony. It is not mandatory that you make use of this location, but highly recommended
if your service produces files that need to be staged.

## 10. Service chaining

In order to support service-chaining--a pipeline of two or more
services that process data--Harmony uses a STAC Catalog that describes
the output of one service, and the input to the next service in the
workflow chain (or pipeline).

In the following Harmony workflow, we show a series of services (in
boxes) and STAC Catalogs between services which describe the data
available for the next service. First, the Granule Locator queries CMR
using the criteria specified in the Harmony request. It then writes a
STAC Catalog describing the Granules and their source URLs, and this
STAC Catalog is provided to the fictional Transmogrifier
Service. After transmogrification is done (not an easy task), the
service writes a STAC Catalog describing its outputs with URLs. Again,
the fictional Flux Decoupler service does its thing (easier than it
sounds) and writes a STAC Catalog. Finally, this is provided to the
Results Handler which stages the final output artifacts in S3 and
Harmony provides a STAC Catalog describing the final output of the
original Harmony request.

     -----------------------------
     |     Granule Locator       |
     -----------------------------
                  |
           (STAC Catalog)
                  |
     -----------------------------
     |  Transmogrifier Service   |
     -----------------------------
                  |
           (STAC Catalog)
                  |
     -----------------------------
     |  Flux Decoupler Service   |
     -----------------------------
                  |
           (STAC Catalog)
                  |
     -----------------------------
     |     Results Handler       |
     -----------------------------
                  |
           (STAC Catalog)

The Harmony Service Library automatically handles reading and writing
the STAC catalogs.
