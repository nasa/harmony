# Adapting New Services to Harmony

**IMPORTANT! This documentation concerns features under active development. Additional methods of service integration are currently being implemented and existing ones refined. Please reach out in #harmony-service-providers for the latest, for particular adaptation needs, and especially with any feedback that can help us improve.**

In order to connect a new service to Harmony:

1. The service must be exposed in a way that Harmony can invoke it
2. The service must be able to accept requests produced by Harmony
3. The service must send results back to Harmony
4. The service must be able to handle request cancellations received by Harmony
5. A new entry in [services.yml](../config/services.yml) must supply information about the service
6. A new Argo workflow template needs to supply the information to invoke the service as part of a workflow
7. The service should follow Harmony's recommendations for service implementations
8. The docker image for the service must be published somewhere for harmony to reach

A simple reference service, [harmony-service-example](https://github.com/nasa/harmony-service-example), provides examples of each. The remainder of this document describes how to fulfill these requirements in more depth.

## 1. Allowing Harmony to invoke services

Harmony provides a Python library, [harmony-service-lib-py](https://github.com/nasa/harmony-service-lib-py), to ease the process of adapting Harmony messages to subsetter code. It provides helpers for message parsing, command line interactions, data staging, reading and writing STAC catalogs, and Harmony callbacks. Full details as well as an example can be found in the project's README and code.

### Docker Container Images

The service and all necessary code and dependencies to allow it to run can be packaged in a Docker container image. Docker images can be staged anywhere Harmony can reach them, e.g. Dockerhub or AWS ECR. Harmony will run the Docker image, passing the following command-line parameters:

`--harmony-action <action> --harmony-input <input> --harmony-sources <sources-file>`

`<action>` is the action Harmony wants the service to perform. Currently, Harmony only uses `invoke`, which requests that the service be run and exit. The service library Harmony provides also supports a `start` action with parameter `--harmony-queue-url <url>`, which requests that the service be started as a long running service that reads requests from an SQS queue. This is likely to be deprecated.

`<input>` is a JSON string containing the details of the service operation to be run. See the latest [Harmony data-operation schema](../app/schemas/) for format details.

`<sources-file>` is an optional file path that may contain a JSON document whose root-level keys should override keys in `<input>`. The intent of this file is to allow Harmony to externalize the potentially very long list of input sources to avoid command line limits while retaining the remainder of the message on the command line for easier manipulation in workflow definitions.

The `Dockerfile` in the harmony-service-example project serves as a minimal example of how to set up Docker to accept these inputs using the `ENTRYPOINT` declaration.

In addition to the defined command-line parameters, Harmony can provide the Docker container with environment variables as set in [services.yml](../config/services.yml) by setting `service.type.params.env` key/value pairs. See the existing services.yml for examples.
### Synchronous HTTP

The service can expose an HTTP(S) URL reachable by Harmony either over the public internet or a more trusted network. When configured to do so (see #4 below), Harmony will POST JSON strings containing service requests and following the [Harmony data-operation schema](../app/schemas/) to the URL. It will then convey the HTTP response to the user as detailed in "#3. Sending results to Harmony" below. See [example/http-backend.js](../example/http-backend.js) in the Harmony root for a working test server example.

Note that the URL can coexist with other access methods for the same service running on the same server, so the same service could be presented both to Harmony using its protocol and to end users using a different protocol.

Harmony's POST requests are currently unauthenticated, though plans to convey Earthdata Login information to the backend are under discussion.

## 2. Accepting Harmony requests

When invoking a service, Harmony provides an input detailing the specific operations the service should perform and the URLs of the data it should perform the operations on. Each new service will need to adapt this message into an actual service invocation, typically transforming the JSON input into method calls, command-line invocations, or HTTP requests. See the latest [Harmony data-operation schema](../app/schemas/) for details on Harmony's JSON input format.

Ideally, this adaptation would consist only of necessary complexity peculiar to the service in question. Please let the team know if there are components that can make this process easier and consider sending a pull request or publishing your code if you believe it can help future services.

## 3. Sending results to Harmony

In addition to the examples below, we provide an [Open API schema](../app/schemas/service-callbacks/0.1.0/service-callbacks-v0.1.0.yml) detailing all of the parameters available and their constraints.

### Synchronous responses

Synchronous requests are ones where a user has made a call to Harmony and the corresponding HTTP request remains open awaiting a response.

#### For Docker services

Since Harmony has moved to using Argo to kick off Docker services, services are no longer required to call back to harmony in order to provide service responses. Services can optionally call back to Harmony as described below using an HTTP POST to the URL provided in the `callback` field of the Harmony input.

The following are the options for how to call back to the Harmony URL:

##### Staged response data

`${operation.callback}/response?redirect=<url>`

If data has been staged at an accessible location, for instance by pre-signing an S3 URL, the URL can be provided in the "redirect" query parameter and Harmony will issue an HTTP redirect to the staged data. This is the preferred callback method if there is not substantial performance to be gained by streaming data to the user. For best compatibility, ensure the `Content-Type` header will be sent by the staging URL.

##### Streaming response data

`${operation.callback}/response`

If no query parameters are provided and a POST body is present, Harmony will stream the POST body directly to the user as it receives data, conveying the appropriate `Content-Type` and `Content-Size` headers set in the callback. Use this method if the service builds its response incrementally and the user would benefit from a partial response while waiting on the remainder.

##### Response errors

`${operation.callback}/response?error=<message>`

If an error occurs, it can be provided in the "message" query parameter and Harmony will convey it to the user in a format suitable for the protocol.

All log messages should be directed to stdout, and all messages should be in JSON format. Harmony will capture all output on both stdout and stderr, and those logs will be available in the metrics system. By using JSON, metrics from the backend services can easily be extracted.

#### For HTTP services

Unlike Docker services, HTTP services *do not* receive a callback URL in an incoming synchronous request. When a service completes, it responds to Harmony's original HTTP request with the results in one of three ways, based on the HTTP response status code:

### Asynchronous responses

Asynchronous requests are ones where a user has made a call to Harmony and Harmony has replied with a URL to poll for results as they arrive.

Similar to synchronous requests to Docker services, Harmony provides a callback URL for all asynchronous requests, in the input's `callback` field.

##### Callback with partial result

`${operation.callback}/response?item[href]=<url>&item[type]=<media-type>&item[temporal]=<date>&item[bbox]=<spatial-extent>&item[title]=<title>`

When the service completes a file, it can indicate the file is complete by calling back to this endpoint. `item[href]` and `item[type]` query parameters are required. `item[href]` must contain the location (typically an S3 object URI) of the resulting item and `item[type]` must contain the media type of the file, e.g. `application/geo+tiff`. `item[title]` is an optional human-readable name for the result.

In order for Harmony to create STAC metadata for asynchronous requests based on the transformed output file extents, the service needs to send updated bounding box and temporal range values as `item[bbox]` and `item[temporal]`, respectively. If no spatial or temporal modifications were performed by the service, then the original spatial and temporal values from the CMR metadata should be returned in the response.

##### Callback with progress update

`${operation.callback}/response?progress=<percentage>`

To provide better feedback to users, a service can estimate its percent complete by performing this callback, providing an integer percentage from 0-100.  Harmony automatically starts the percentage at 0 and automatically sets it to 100 when the service completes, so this is only necessary for providing intermediate status.

This query parameter can be provided with partial results, if a service is tracking percent complete by the number of files it has completed, e.g. `${operation.callback}/response?item[href]=s3://example/file&item[type]=image/png&progress=25`

##### Callback with single result

`${operation.callback}/response?redirect=<url>`

For the convenience of services that only ever produce a single result and cannot provide status, Harmony will accept the same callback
as in the synchronous case.

##### Response errors
`${operation.callback}/response?error=<message>`

If an error occurs, it can be provided in the "message" query parameter and Harmony will convey it to the user in a format suitable for the protocol.  Harmony captures STDOUT from Docker containers for further diagnostics. On error, the job's progress will remain set at the most recently set progress value and it will retain any partial results. Services can use this to provide partial results to users in the case of recoverable errors.

#### Status 2xx, success

The service call was successful and the response body contains bytes constituting the resulting file. Harmony will use the `Content-Size` and `Content-Type` headers to provide appropriate information to users or downstream services.

#### Status 3xx, redirect

The service call was successful and the resulting file can be found at the _fully qualified_ URL contained in the `Location` header.

#### Status 4xx and 5xx, client and server errors

The service call was unsuccessful due to an error. The error message is the text of the response body. Harmony will convey the message verbatim to the user when permitted by the user's request protocol. Error status codes should follow [RFC-7231](https://tools.ietf.org/html/rfc7231#section-6), with 4xx errors indicating client errors such as validation or access problems and 5xx errors indicating server errors like unexpected exceptions.

## 4. Canceled requests

A harmony admin or a user may cancel a request in flight. When a request has been canceled, Harmony will return a 409 HTTP status code to any callback indicating that the request is canceled, and will not allow adding any new job outputs. No more work should be performed on the request by the backend service at that point.

## 5. Registering services in services.yml

Add an entry to [services.yml](../config/services.yml) under each CMR environment that has collections / granules appropriate to the service and send a pull request to the Harmony team, or ask a Harmony team member for assistance.

Note that you will need to define 3 environment variables for your service as well. Add the defaults for these environment variables to the [env-defaults](../env-defaults) file with the other service environment variables in the 'Service Config' section.

<service name>_IMAGE              # The docker image and tag to use for the service locally. Generally default to using the 'latest' tag.
<service name>_IMAGE_PULL_POLICY  # Default this value to 'IfNotPresent' locally. Other values are described in `env-defaults`.
<service name>_PARALLELISM        # The maximum number of batches to concurrently run for a workflow for this service. Generally default to 2.

The structure of an entry in the [services.yml](../config/services.yml) file is as follows:

```yaml
- name: harmony/docker-example     # A unique identifier string for the service, conventionally <team>/<service>
  data_operation_version: '0.10.0' # The version of the data-operation messaging schema to use
  type:                            # Configuration for service invocation
      <<: *default-argo-config     # Docker based services use Argo. To reduce boilerplate, services.yml includes default configuration suitable for all Argo based services.
      params:
        <<: *default-argo-params             # Always include the default argo parameters for Argo services
        template: harmony-service-example    # Name of the argo workflow template
        template_type: chaining              # All new services should use the 'chaining' workflow template type, which utilizes a docker service to query the CMR for granules and STAC catalogs to read inputs and provide outputs. It allows multiple services to be chained together within a single workflow. There may be a few existing services that use the deprecated 'legacy' type only allowing for a single service in a workflow.
        image: !Env ${HARMONY_EXAMPLE_IMAGE} # The docker image and tag to use for the service. Use an environment variable in order to allow changing the image and tag in different environments.
        image_pull_policy: !Env ${HARMONY_EXAMPLE_IMAGE_PULL_POLICY} # The image pull policy to use to determine when a docker image should be pulled prior to starting a pod to execute a service. See the TBD section describing pull policies.
        parallelism: !Env ${HARMONY_EXAMPLE_PARALLELISM} # The maximum number of concurrent batches that can be executed for a workflow. Use an environment variable to allow for different configuration in different environments.
        env:
          <<: *default-argo-env                        # Always include the default Argo environment variables and then add service specific env
          STAGING_PATH: public/harmony/service-example # The S3 prefix where artifacts generated by the service will be stored
  umm_s:                          # A list of CMR service IDs for the service (optional)
    - S1234-EXAMPLE
  collections:                    # A list of CMR collection IDs that the service works on
    - C1234-EXAMPLE
  batch_size: 1                   # The number of granules in each batch operation (defaults to 0 which means unlimited)
  maximum_sync_granules: 1        # Optional limit for the maximum number of granules for a request to be handled synchronously. Defaults to 1. Set to 0 to only allow async requests.
  maximum_async_granules: 500     # Optional limit for the maximum number of granules allowed for a single async request. Harmony has a MAX_GRANULE_LIMIT enforced for all services.
  capabilities:                   # Service capabilities
    subsetting:
      bbox: true                  # Can subset by spatial bounding box
      variable: true              # Can subset by UMM-Var variable
      multiple_variable: true     # Can subset multiple variables at once
    output_formats:               # A list of output mime types the service can produce
      - image/tiff
      - image/png
      - image/gif
    reprojection: true            # The service supports reprojection

- name: harmony/http-example      # An example of configuring the HTTP backend
  type:
    name: http                    # This is an HTTP endpoint
    params:
      url: http://www.example.com/harmony  # URL for the backend service
  # ... And other config (collections / capabilities) as in the above docker example
```

This format is under active development. In the long-term a large portion of it is likely to be editable and discoverable through the CMR via UMM-S. As of this writing, collections on which a service works can
be supplied in one of two ways:

1. directly through the `collections` entry in a service config in `services.yml`
2. by [creating a UMM-S/UMM-C association](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html#service-association) in the CMR and then adding the UMM-S CMR concept ID to the `umm_s` field
in a service config in `services.yml`.

The second method is now the preferred approach to adding collections to a service as it allows
collections to be added/removed to/from an existing service without requiring a pull request or 
deployment.

If you intend for Harmony job results that include this collection to be shareable, make sure that guests have `read` permission on the collection (via [CMR ACLs endpoints](https://cmr.earthdata.nasa.gov/access-control/site/docs/access-control/api.html)), and if no EULAs are present that the `harmony.has-eula` tag is associated with the collection and set to `false` via the CMR `/search/tags/harmony.has-eula/associations` endpoint. Example request body: `[{"concept_id": "C1233860183-EEDTEST", "data": false}]`. All collections used in the Harmony job must meet these two requirements in order for the job to be shareable.

## 6. Creating a workflow template for the service

Docker based services are invoked from within Argo (HTTP based services can skip this step). Argo uses workflow templates to provide the instructions for executing a request. Harmony provides templates for common steps within workflows such as querying the CMR for granules and providing those as inputs to later steps and responding back to Harmony to provide outputs.

In order to create a template that executes a single service create a new workflow template YAML file in the `config/workflow-templates` directory. The name of the file is important. It needs to be `<service_name>.yaml` where service_name matches the the template name defined in services.yml.

The structure of the file is below. The easiest way to create the template is to copy/paste the harmony-service-example.yaml template and replace all instances of 'harmony-service-example' with the name of the new service since there is a large amount of boilerplate in each workflow template file:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: harmony-service-example
spec:
  entrypoint: harmony-service-example-steps
  templates:
    - name: harmony-service-example-steps
      inputs:
        artifacts:
        - name: metadata
        parameters:
          - name: operation
          - name: stac-catalog-link
          - name: image-pull-policy
          - name: timeout
          - name: STAGING_PATH
      steps:
      - - name: last-step
          template: harmony-service-example-service
          arguments:
            artifacts:
            - name: metadata
              from: "{{inputs.artifacts.metadata}}"
            parameters:
            - name: operation
              value: "{{inputs.parameters.operation}}"
            - name: stac-catalog-link
              value: "{{inputs.parameters.stac-catalog-link}}"
            - name: image-pull-policy
              value: "{{inputs.parameters.image-pull-policy}}"
            - name: timeout
              value: "{{inputs.parameters.timeout}}"
            - name: STAGING_PATH
              value: "{{inputs.parameters.STAGING_PATH}}"
      outputs:
        artifacts:
          - name: metadata
            from: "{{steps.last-step.outputs.artifacts.metadata}}"
        parameters:
          - name: stac-catalog-link
            valueFrom:
              parameter: "{{steps.last-step.outputs.parameters.stac-catalog-link}}"
    - name: harmony-service-example-service
      inputs:
        artifacts:
        - name: metadata
          path: /tmp/metadata
        parameters:
          - name: operation
          - name: stac-catalog-link
          - name: image-pull-policy
          - name: timeout
          - name: STAGING_PATH
      outputs:
        artifacts:
        # generate metadata artifact from /tmp/outputs directory
          - name: metadata
            path: /tmp/outputs/metadata
        parameters:
          - name: stac-catalog-link
            value: catalog.json
          - name: operation
            valueFrom:
              path: /tmp/outputs/metadata/message.json
      podSpecPatch: '{"activeDeadlineSeconds":{{inputs.parameters.timeout}}}'
      container:
        image: "<DOCKER_IMAGE>"
        imagePullPolicy: "{{inputs.parameters.image-pull-policy}}"
        command: ["python3"]           # Command to run on container startup
        args:
          [
            "-m",
            "harmony_service_example", # Replace this with the command to run the service
            "--harmony-action",
            "invoke",
            "--harmony-input",
            "{{inputs.parameters.operation}}",
            "--harmony-sources",
            "{{inputs.artifacts.metadata.path}}/{{inputs.parameters.stac-catalog-link}}",
            "--harmony-metadata-dir",
            "{{outputs.artifacts.metadata.path}}"
          ]
        envFrom:
          - configMapRef:
              name: harmony-env
          - secretRef:
              name: harmony-secrets
        env:
          - name: STAGING_PATH
            value: "{{inputs.parameters.STAGING_PATH}}"
          - name: APP_NAME
            value: "harmony-service-example"
```

### Service chaining

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

## 7. Recommendations for service implementations

Note that several of the following are under active discussion and we encourage participation in that discussion.

In order to improve user experience, metrics gathering, and to allow compatibility with future development, Harmony strongly encourages service implementations to do the following:

1. Provide provenance information in output files in a manner appropriate to the file format and following EOSDIS guidelines, such that a user can recreate the output file that was generated through Harmony. The following fields are recommended to include in each output file. Note that the current software citation fields include backend service information; information on Harmony workflow is forthcoming. For NetCDF outputs, information specific to the backend service should be added to the `history` global attribute, with all other fields added as additional global attributes. For GeoTIFF outputs, these fields can be included under `metadata` as `TIFFTAG_SOFTWARE`. See the [NASA ESDS Data Product Development Guide for Data Producers](https://earthdata.nasa.gov/files/ESDS-RFC-041.pdf) for more guidance on provenance information.

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

## 8. Publishing the docker image

For docker based services Harmony will need to be able to pull the image. Harmony can point to a publicly available repository (generally Dockerhub) for the images. If the image cannot be made publicly available, contact the harmony team to determine how to provide access to the image.

