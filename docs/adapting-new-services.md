# Adapting New Services to Harmony

**IMPORTANT! This documentation concerns features under active development.  Additional methods of service integration are currently being implemented and existing ones refined.  Please reach out in #harmony for the latest, for particular adaptation needs, and especially with any feedback that can help us improve.**

In order to connect a new service to Harmony:

1. The service must be exposed in a way that Harmony can invoke it
2. The service must be able to accept requests produced by Harmony
3. The service must send results back to Harmony
4. A new entry in [services.yml](../config/services.yml) must supply information about the service
5. The service should follow Harmony's recommendations for service implementations

A simple reference service, [harmony-gdal](https://git.earthdata.nasa.gov/projects/HARMONY/repos/harmony-gdal/browse), provides examples of each. The remainder of this document describes how to fulfill these requirements in more depth.

## 1. Allowing Harmony to invoke services

Harmony provides a Python library, [harmony-service-lib-py](https://git.earthdata.nasa.gov/projects/HARMONY/repos/harmony-service-lib-py/browse), to
ease the process of adapting Harmony messages to subsetter code.  It provides helpers for message parsing, command line interactions, data staging,
and Harmony callbacks.  Full details as well as an example can be found in the project's README and code.

At present, Harmony only provides one way of packaging a service for invocation: Docker container images.

### Docker Container Images

The service and all necessary code and dependencies to allow it to run can be packaged in a Docker container image.  Docker images can be staged anywhere Harmony can reach them, e.g. Dockerhub or AWS ECR.  Harmony will run the Docker image, passing the following command-line parameters:

`--harmony-action <action> --harmony-input <input>`

`<action>` is the action Harmony wants the service to perform, currently only `invoke`, which requests that the service be run.  This may be expanded in the future for additional actions such as capability discovery.

`<input>` is a JSON string containing the details of the service operation to be run.  See the latest [Harmony data-operation schema](../app/schemas/) for format details.

The `Dockerfile` in the harmony-gdal project serves as a minimal example of how to set up Docker to accept these inputs using the `ENTRYPOINT` declaration.

In addition to the defined command-line parameters, Harmony can provide the Docker container with environment variables as set in [services.yml](../config/services.yml) by setting `service.type.params.env` key/value pairs.  See the existing services.yml for examples.

### Synchronous HTTP

The service can expose an HTTP(S) URL reachable by Harmony either over the public internet or a more trusted network.  When configured to do so (see #4 below), Harmony will POST JSON strings containing service requests and following the [Harmony data-operation schema](../app/schemas/) to the URL.  It will then convey the HTTP response to the user as detailed in "#3. Sending results to Harmony" below.  See [example/http-backend.js](../example/http-backend.js) in the Harmony root for a working test server example.

Note that the URL can coexist with other access methods for the same service running on the same server, so the same service could be presented both to Harmony using its protocol and to end users using a different protocol.

Harmony's POST requests are currently unauthenticated, though plans to convey Earthdata Login information to the backend are under discussion.

## 2. Accepting Harmony requests

When invoking a service, Harmony provides an input detailing the specific operations the service should perform and the URLs of the data it should perform the operations on.  Each new service will need to adapt this message into an actual service invocation, typically transforming the JSON input into method calls, command-line invocations, or HTTP requests.  See the latest [Harmony data-operation schema](../app/schemas/) for details on Harmony's JSON input format.

Ideally, this adaptation would consist only of necessary complexity peculiar to the service in question.  Please let the team know if there are components that can make this process easier and consider sending a pull request or publishing your code if you believe it can help future services.

## 3. Sending results to Harmony

### Synchronous responses

Synchronous requests are ones where a user has made a call to Harmony and the corresponding HTTP request remains open awaiting a response.

#### For Docker services

Once complete, a service must send an HTTP POST request to the URL provided in the `callback` field of the Harmony input.  Failing to do so will cause user requests to hang until a timeout that is likely long in order to accommodate large, synchronous operations.  Please be mindful of this and provide ample error handling.

The following are the options for how to call back to the Harmony URL:

##### Staged response data

`${operation.callback}/response?redirect=<url>`

If data has been staged at an accessible location, for instance by pre-signing an S3 URL, the URL can be provided in the "redirect" query parameter and Harmony will issue an HTTP redirect to the staged data.  This is the preferred callback method if there is not substantial performance to be gained by streaming data to the user.  For best compatibility, ensure the `Content-Type` header will be sent by the staging URL.

##### Streaming response data

`${operation.callback}/response`

If no query parameters are provided and a POST body is present, Harmony will stream the POST body directly to the user as it receives data, conveying the appropriate `Content-Type` and `Content-Size` headers set in the callback.  Use this method if the service builds its response incrementally and the user would benefit from a partial response while waiting on the remainder.

##### Response errors

`${operation.callback}/response?error=<message>`

If an error occurs, it can be provided in the "message" query parameter and Harmony will convey it to the user in a format suitable for the protocol.

All log messages should be directed to stdout, and all messages should be in JSON format. Harmony will capture all output on both stdout and stderr, and those logs will be available in the metrics system. By using JSON, metrics from the backend services can easily be extracted.

#### For HTTP services

Unlike Docker services, HTTP services *do not* receive a callback URL in an incoming synchronous request.  When a service completes, it responds to Harmony's original HTTP request with the results in one of three ways, based on the HTTP response status code:

### Asynchronous responses

Asynchronous requests are ones where a user has made a call to Harmony and Harmony has replied with a URL to poll for results as they arrive.

Similar to synchronous requests to Docker services, Harmony provides a callback URL for all asynchronous requests, in the input's `callback` field.

##### Callback with partial result

`${operation.callback}/response?item[href]=<url>&item[type]=<media-type>&item[title]=<title>`

When the service completes a file, it can indicate the file is complete by calling back to this endpoint.  `item[href]` and `item[type]` query parameters are required.  `item[href]` must contain the location (typically an S3 object URI) of the resulting item and `item[type]` must contain the media type of the file, e.g. `application/geo+tiff`.  `item[title]` is an optional human-readable name for the result.

##### Callback with progress update

`${operation.callback}/response?progress=<percentage>`

To provide better feedback to users, a service can estimate its percent complete by performing this callback, providing an integer percentage from 0-100.  Harmony automatically starts the percentage at 0 and automatically sets it to 100 when the service completes, so this is only necessary for providing intermediate status.

This query parameter can be provided with partial results, if a service is tracking percent complete by the number of files it has completed, e.g. `${operation.callback}/response?item[href]=s3://example/file&item[type]=image/png&progress=25`

##### Indicate the service has been completed

`${operation.callback}/response?status=successful`

Once a service completes, it *must* call back to Harmony with either a successful status or an error (see below).  The above URL template indicates a success status.  The `status=successful` query parameter may also be provided with partial results.  Harmony will also accept a `progress=` parameter but will ignore it and set the progress to 100, as the service is completed.

##### Callback with single result

`${operation.callback}/response?redirect=<url>`

For the convenience of services that only ever produce a single result and cannot provide status, Harmony will accept the same callback
as in the synchronous case.

##### Response errors
`${operation.callback}/response?error=<message>`

If an error occurs, it can be provided in the "message" query parameter and Harmony will convey it to the user in a format suitable for the protocol.  Harmony captures STDOUT from Docker containers for further diagnostics.  On error, the job's progress will remain set at the most recently set progress value and it will retain any partial results.  Services can use this to provide partial results to users in the case of recoverable errors.

#### Status 2xx, success

The service call was successful and the response body contains bytes constituting the resulting file.  Harmony will use the `Content-Size` and `Content-Type` headers to provide appropriate information to users or downstream services.

#### Status 3xx, redirect

The service call was successful and the resulting file can be found at the _fully qualified_ URL contained in the `Location` header.

#### Status 4xx and 5xx, client and server errors

The service call was unsuccessful due to an error.  The error message is the text of the response body.  Harmony will convey the message verbatim to the user when permitted by the user's request protocol.  Error status codes should follow [RFC-7231](https://tools.ietf.org/html/rfc7231#section-6), with 4xx errors indicating client errors such as validation or access problems and 5xx errors indicating server errors like unexpected exceptions.

## 4. Registering services in services.yml

Add an entry to [services.yml](../config/services.yml) and send a pull request to the Harmony team, or ask a Harmony team member for assistance.  The structure of an entry is as follows:

```yaml
- name: harmony/docker-example    # A unique identifier string for the service, conventionally <team>/<service>
  data_operation_version: '0.4.0' # The version of the data-operation messaging schema to use
  type:                           # Configuration for service invocation
    name: docker                  # The type of service invocation, currently only "docker"
    params:                       # Parameters specific to the service invocation type
      image: harmony/example      # The Docker container image to run
      env:                        # Environment variables to pass to the image
        EDL_USERNAME: !Env ${EDL_USERNAME}  # Note the syntax for reading environment variables from Harmony itself
        EDL_PASSWORD: !Env ${EDL_PASSWORD}  # to avoid placing secrets in git.  Ask the team for assistance if you need this
  collections:                    # A list of CMR collection IDs that the service works on
    - C1234-EXAMPLE
  capabilities:                   # Service capabilities
    subsetting:
      bbox: true                  # Can subset by spatial bounding box
      variable: true              # Can subset by UMM-Var variable
      multiple_variable: true     # Can subset multiple variables at once
    output_formats:               # A list of output mime types the service can produce
      - image/tiff
      - image/png
      - image/gif
    projection_to_proj4: true     # The service can project to Proj4 and EPSG codes

- name: harmony/http-example      # An example of configuring the HTTP backend
  type:
    name: http                    # This is an HTTP endpoint
    params:
      url: http://www.example.com/harmony  # URL for the backend service
  # ... And other config (collections / capabilities) as in the above docker example
```

This format is under active development.  In the long-term a large portion of it is likely to be editable and discoverable through the CMR via UMM-S.

## 5. Recommendations for service implementations

Note that several of the following are under active discussion and we encourage participation in that discussion

In order to improve user experience, metrics gathering, and to allow compatibility with future development, Harmony strongly encourages service implementations to do the following:

1. Provide provenance information in output files in a manner appropriate to the file format and following EOSDIS guidelines.  Typically this would consist of a list of commands that were run by the service as well as key software versions.
2. Preserve existing file metadata where appropriate.  This includes file-level metadata that has not changed, layer metadata, and particularly provenance metadata that may have been generated by prior transformations.
3. Log request callback URLs, which serve as unique identifiers, as well as Earthdata Login usernames when available to aid in tracing requests and debugging.
4. Proactively protect (non-Docker) service endpoints from high request volume or computational requirements by using autoscaling with maximum thresholds, queueing, and other methods to avoid outages or non-responsiveness.
5. Use the latest available data-operation schema. As harmony development continues the schema will evolve to support new features, which will require services be compatible with the new schema in order to take advantage of those features. In addition code to support older versions of the schema can be retired once all services have updated to later versions of the schema.