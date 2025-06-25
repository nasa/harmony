# harmony-service-lib

The `harmony-service-lib` project is a Python library designed to simplify the development of Harmony services. It provides essential tools for parsing incoming messages, fetching and staging data, and interacting seamlessly with Harmony's backend APIs. By using this library, developers can streamline their integration with Harmony while ensuring compatibility with future upgrades.

This library is particularly beneficial for developers building or maintaining Python-based Harmony services, enabling efficient interoperability and reducing the complexity of common tasks.

## Where It Fits In

Each Harmony service runs as a Docker container within a Kubernetes pod. Harmony processes user requests and, based on service configurations, determines which service to invoke via the Harmony Service CLI. The Harmony Service CLI defines both the input and output as STAC catalogs. Harmony executes the service in Kubernetes through a command-line call to the service pod entrypoint with the following parameters:

```sh
--harmony-action <action> \
--harmony-input <input> \
--harmony-sources <sources-file> \
--harmony-metadata-dir <output-dir>
```

- `<action>`: Specifies the action Harmony wants the service to perform. Currently, the only supported action is `invoke`, which runs the service and exits.
- `<input>`: A JSON string containing the details of the service operation. Refer to the latest [Harmony data-operation schema](https://github.com/nasa/harmony/tree/main/services/harmony/app/schemas/data-operation) for format details.
- `<sources-file>`: A file path pointing to a STAC catalog with items and metadata for processing. This allows Harmony to manage large input lists without exceeding command-line limits.
- `<output-dir>`: The directory where the service should write its output metadata. The resulting STAC catalog will be saved as `catalog.json` in this directory.

This library provides essential functions for parsing command-line parameters, processing source STAC catalogs, generating result STAC catalogs, managing logs, and more.

## Key Features

### Message Handling
- Supports receiving and processing Harmony messages via CLI (future HTTP support planned).
- Includes helper functions in `harmony_service_lib.cli` for seamless CLI parsing alongside non-Harmony CLI implementations.

### Adapter-Based Service Development
Developers can create Harmony-compatible services by extending the `harmony_service_lib.BaseHarmonyAdapter` class. There are two primary ways to do this:

- **Override `invoke`**: Process complete messages and generate results.
- **Override `process_item`**: Handle individual STAC items from input catalogs.

The adapter also provides utilities for retrieving remote data, staging output, STAC catalog manipulation, and managing temporary files, which can be customized as needed.

## Examples and Guidance

### Simple Service Example
See the [example service](example/example_service.py) for a demonstration of how to:
- Receive Harmony CLI command-line calls.
- Process input STAC items.
- Generate an output STAC catalog.
- Utilize library functions for message parsing, data handling, STAC manipulation, logging, and error handling.

This approach requires only a minimal override of `process_item` in `BaseHarmonyAdapter`, allowing developers to focus on business logic while leveraging built-in functionalities.

### Aggregation Example
For services that aggregate multiple inputs into a single output, see [Concise Service](https://github.com/podaac/concise). This example overrides `invoke` to:
- Download granules specified in the source STAC catalog.
- Merge them into a single output.
- Customize error handling.

### Multi-Output Example
For services that generate multiple outputs from a single input, see [Batchee Service](https://github.com/nasa/batchee). Like Concise Service, this example overrides `invoke`, but instead of merging granules, it:
- Downloads granules specified in the source STAC catalog.
- Processes and Returns the result as a list of STAC catalogs.

## Error handling

The best way to trigger a service failure when an unrecoverable condition is encountered is to extend HarmonyException (a class provided by the service library) and throw an exception of that type. The service library may also throw a HarmonyException when common errors are encountered.

Exceptions of this type (HarmonyException or a subclass) which are meant to be bubbled up to users should _not_ be suppressed by the service. The exception will automatically be caught/handled by the service library. The exception message will be passed on to Harmony and bubbled up to the end user (accessible via the errors field in the job status Harmony endpoint (`/jobs/<job-id>`) and in many cases via the final job message).

Services can fail for other unforeseen reasons, like running out of memory, in which case Harmony will make an effort to provide a standardized error message. Just because a service invocation results in failure does not mean that the entire job itself will fail. Other factors that come into play are retries and cases where a job completes with errors (partial success). Retries happen automatically (up to a Harmony-wide configured limit) on failed data downloads and service failures.

### HarmonyException Levels
HarmonyExceptions are categorized into two levels: `Error` and `Warning`. The default level is `Error`.

- `Error` exceptions appear in the job status under `errors`.
- `Warning` exceptions appear in the job status under `warnings`.

### Built-in Harmony Exceptions
harmony_service_lib provides the following custom exceptions:

- **CanceledException**: Raised when a Harmony request is canceled.
- **ForbiddenException**: Raised when access to the requested data is denied (e.g., download failure due to permission issues).
- **ServerException**: Raised for generic 500 internal server errors (e.g., a download failure due to a server issue).
- **NoDataException**: Raised when the service finds no data to process (e.g., no data found by the service in the subset region). This is classified as a `Warning` exception.

### Customized Service Exceptions
When possible, services should strive to give informative error messages that give the end user some sense of why the service failed, without revealing any internal details about the service that could be exploited.

Here is a good example:
```python
"""This module contains custom exceptions specific to the Harmony GDAL Adapter
    service. These exceptions are intended to allow for clearer messages to the
    end-user and easier debugging of expected errors that arise during an
    invocation of the service.
"""

from harmony.exceptions import HarmonyException

class HGAException(HarmonyException):
    """Base class for exceptions in the Harmony GDAL Adapter."""

    def __init__(self, message):
        super().__init__(message, 'nasa/harmony-gdal-adapter')


class DownloadError(HGAException):
    """ This exception is raised when the Harmony GDAL Adapter cannot retrieve
        input data.
    """
    def __init__(self, url, message):
        super().__init__(f'Could not download resource: {url}, {message}')


class UnknownFileFormatError(HGAException):
    """ This is raised when the input file format is one that cannot by
        processed by the Harmony GDAL Adapter.
    """
    def __init__(self, file_format):
        super().__init__('Cannot process unrecognised file format: '
                         f'"{file_format}"')


class IncompatibleVariablesError(HGAException):
    """ This exception is raised when the dataset variables requested are not
    compatible, i.e. they have different projections, geotransforms, sizes or
    data types.
    """
    def __init__(self, message):
        super().__init__(f'Incompatible variables: {message}')


class MultipleZippedNetCDF4FilesError(HGAException):
    """ This exception is raised when the input file supplied to HGA is a zip
        file containing multiple NetCDF-4 files, as these cannot be aggregated.
    """
    def __init__(self, zip_file):
        super().__init__(f'Multiple NetCDF-4 files within input: {zip_file}.')
```

## Installing

### Using pip

Install the latest version of the package from PyPI using pip:

    $ pip install harmony-service-lib

### Other methods:

The package is installable from source via

    $ pip install git+https://github.com/harmony/harmony-service-lib-py.git#egg=harmony-service-lib

If using a local source tree, run the following in the source root directory instead:

    $ pip install -e .

## Environment

The following environment variables can be used to control the behavior of the
library and allow easier testing:

REQUIRED:

* `STAGING_BUCKET`: When using helpers to stage service output and pre-sign URLs, this
       indicates the S3 bucket where data will be staged
* `STAGING_PATH`: When using helpers to stage output, this indicates the path within
       `STAGING_BUCKET` under which data will be staged
* `ENV`: The name of the environment.  If 'dev' or 'test', callbacks to Harmony are
       not made and data is not staged unless also using localstack
* `SHARED_SECRET_KEY`: The 32-byte encryption key shared between Harmony and backend services.
       This is used to encrypt & decrypt the `accessToken` in the Harmony operation message.
       In a production environment, this should be injected into the container running the service
       Docker image. When running the service within Harmony, the Harmony infrastructure will
       ensure that this environment variable is set with the shared secret key, and the Harmony
       service library will read and use this key. Therefore, the service developer need not
       be aware of this variable or its value.

OPTIONAL:

* `APP_NAME`: Defaults to first argument on commandline. Appears in log records.
* `AWS_DEFAULT_REGION`: (Default: `"us-west-2"`) The region in which S3 calls will be made
* `USE_LOCALSTACK`: (Development) If 'true' will perform S3 calls against localstack rather
       than AWS
* `LOCALSTACK_HOST`: (Development) If `USE_LOCALSTACK` `true` and this is set, will
       establish `boto` client connections for S3 operations using this hostname.
* `TEXT_LOGGER`: (Default: True) Setting this to true will cause all
       log messages to use a text string format. By default log
       messages will be formatted as JSON.
* `MAX_DOWNLOAD_RETRIES`: Number of times to retry HTTP download calls that fail due to transient errors.
* `POST_URL_LENGTH`: Minimum url length that will be submitted via POST request.

## Development Setup

Prerequisites:
  - Python 3.9+, ideally installed via a virtual environment
  - A local copy of the code

Install dependencies:

    $ make install

Run linter against production code:

    $ make lint

Run tests:

    $ make test

Build & publish the package:

    $ make publish

## Releasing

GitHub release notes will automatically be generated based on pull request subjects.
Pull request subject lines should therefore concisely emphasize library
user-facing behavior and updates they should appear in the changelog.  If more
information is needed for release notes, note that in the PR content.
