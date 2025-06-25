"""
Utility functions for logging, staging data results for external
access (S3 pre-signed URL), decrypting data using a shared secret, and
operating on message queues.

This module relies heavily on environment variables to know
which endpoints to use and how to authenticate to them as follows:

Required when receiving an encrypted user access token in the message (Always!):
    SHARED_SECRET_KEY:  The 32-byte shared encryption / decryption key to decrypt
                        the access token in the Harmony operation.

Required when reading from or staging to S3:
    AWS_DEFAULT_REGION: The AWS region in which the S3 client is operating (default: "us-west-2")

Required when staging to S3 and not using the Harmony-provided stagingLocation prefix:
    STAGING_BUCKET: The bucket where staged files should be placed
    STAGING_PATH: The base path under which staged files should be placed

Always provided by newer versions of the Harmony frontend:
    USER_AGENT:     The Harmony user agent string. E.g. harmony/0.0.0 (harmony-sit)

Optional when reading from or staging to S3:
    USE_LOCALSTACK:  'true' if the S3 client should connect to a LocalStack instance instead of
                     Amazon S3 (for testing)
    LOCALSTACK_HOST: The hostname of the Localstack to connect to if `USE_LOCALSTACK`.
    BACKEND_HOST:    The hostname of the Harmony backend. Deprecated / unused by this package.

Optional:
    APP_NAME:             A name for the service that will appear in log entries.
    ENV:                  The application environment. One of: dev, test. Used for local development.
    TEXT_LOGGER:          Whether to log in plaintext or JSON. Default: True (plaintext).
    MAX_DOWNLOAD_RETRIES: Number of times to retry HTTP download calls that fail due to transient errors.
    POST_URL_LENGTH:      Minimum url length that will be submitted via POST request.
"""

from base64 import b64decode
from collections import namedtuple
from functools import lru_cache
import hashlib
import logging
from pathlib import Path, PurePath
from os import environ, path
import sys
import re
from urllib import parse

from nacl.secret import SecretBox

from harmony_service_lib import aws
from harmony_service_lib import http
# The following imports are for backwards-compatibility for services
# which import them from `harmony_service_lib.util`. Though they are not used in
# this module, importing them here allows applications to work without
# modifications.
from harmony_service_lib.exceptions import (HarmonyException, CanceledException, ForbiddenException)  # noqa: F401
from harmony_service_lib.logging import build_logger
from harmony_service_lib.version import get_version


DEFAULT_SHARED_SECRET_KEY = '_THIS_IS_MY_32_CHARS_SECRET_KEY_'


Config = namedtuple(
    'Config', [
        'app_name',
        'use_localstack',
        'backend_host',
        'localstack_host',
        'aws_default_region',
        'staging_path',
        'staging_bucket',
        'env',
        'text_logger',
        'shared_secret_key',
        'user_agent',
        'max_download_retries',
        'post_url_length'
    ])


def _validated_config(config):
    """Validates that the given Config has values for all required
    variables and returns it if so. Raises an Exception if invalid.
    """
    required = [
        'shared_secret_key',
        'staging_path',
        'staging_bucket',
        'max_download_retries'
    ]

    unset = [var.upper() for var in required if getattr(config, var) is None]

    if len(unset) > 0:
        msg = f"Required environment variables are not set: {', '.join(unset)}"
        raise Exception(msg)

    # Warnings
    if config.shared_secret_key == DEFAULT_SHARED_SECRET_KEY:
        logging.warning("The SHARED_SECRET_KEY has not been set. Currently set to its default (unsecure) value.")

    logging.info(config)

    return config


@lru_cache(maxsize=128)
def config(validate=True):
    """
    Returns the Config object with all parameters set to values that were set in the
    process' environment (as environment variables), or to their default values if not
    set.

    Parameters
    ----------
    validate : bool
        Whether to validate the config before returning it. Useful to disable when
        running unit tests.

    Returns
    -------
    harmony_service_lib.util.Config
        The configuration values for this runtime environment.
    """
    def str_envvar(name: str, default: str) -> str:
        value = environ.get(name, default)
        return value.strip('\"') if value is not None else None

    def bool_envvar(name: str, default: bool) -> bool:
        value = environ.get(name)
        return str.lower(value) == 'true' if value is not None else default

    def int_envvar(name: str, default: int) -> int:
        value = environ.get(name)
        return int(value) if value is not None else default

    backend_host = str_envvar('BACKEND_HOST', 'localhost')
    localstack_host = str_envvar('LOCALSTACK_HOST', backend_host)

    config = Config(
        app_name=str_envvar('APP_NAME', sys.argv[0]),
        use_localstack=bool_envvar('USE_LOCALSTACK', False),
        backend_host=backend_host,
        localstack_host=localstack_host,
        aws_default_region=str_envvar('AWS_DEFAULT_REGION', 'us-west-2'),
        staging_path=str_envvar('STAGING_PATH', None),
        staging_bucket=str_envvar('STAGING_BUCKET', None),
        env=str_envvar('ENV', ''),
        text_logger=bool_envvar('TEXT_LOGGER', False),
        shared_secret_key=str_envvar('SHARED_SECRET_KEY', DEFAULT_SHARED_SECRET_KEY),
        user_agent=str_envvar('USER_AGENT', 'harmony (unknown version)'),
        max_download_retries=int_envvar('MAX_DOWNLOAD_RETRIES', 0),
        post_url_length=int_envvar('POST_URL_LENGTH', 2000)
    )

    if validate:
        return _validated_config(config)
    else:
        return config


def _build_full_user_agent(config) -> str:
    """
    Builds a user-agent string that can be passed on to aws or http clients.
    The user agent may consist of a user agent defined by an env variable passed
    by newer versions of Harmony, a user agent for this service lib, and an optional user
    agent that can be provided by users of this lib.

    Parameters
    ----------
    config : harmony_service_lib.util.Config
        The configuration values for this runtime environment.

    Returns
    -------
    string
        A user agent string.
    """
    harmony_user_agent = config.user_agent
    app_name = config.app_name
    lib_user_agent = f'harmony-service-lib/{get_version()}'
    full_user_agent = f'{harmony_user_agent} {lib_user_agent}'
    if app_name is not None:
        full_user_agent += f' ({app_name})'
    return full_user_agent


def _is_file_url(url: str) -> bool:
    return url is not None and url.startswith('file://')


def _url_as_filename(url: str) -> str:
    """Return a version of the url optimized for local development.

    If the url is a `file://` url, it will return the remaining part
    of the url so it can be used as a local file path. For example,
    'file:///logs/example.txt' will be converted to
    '/logs/example.txt'.

    Parameters
    ----------
    url: str The url to check and optaimize.
    Returns
    -------
    str: The url converted to a filename.

    """
    return url.replace('file://', '')


def _filename(directory_path: str, url: str) -> Path:
    """Constructs a filename from the url using the specified directory
    as its path. The constructed filename will be a sha256 hash
    (converted to a hex digest) of the url, and the file's extension
    will be the same as that of the filename in the url.

    Parameters
    ----------
    directory_path : str
        The url to use when constructing the filename and extension.
    Returns
    -------

    """
    return Path(
        directory_path,
        hashlib.sha256(url.encode('utf-8')).hexdigest()
    ).with_suffix(PurePath(parse.urlparse(url).path).suffix)


def download(url, destination_dir, logger=None, access_token=None, data=None, cfg=None):
    """
    Downloads the given URL to the given destination directory, using the basename of the URL
    as the filename in the destination directory.  Supports http://, https:// and s3:// schemes.
    When using the s3:// scheme, will run against us-west-2 unless the "AWS_DEFAULT_REGION"
    environment variable is set.

    When using http:// or https:// schemes, the access_token will be used for authentication.

    Parameters
    ----------
    url : string
        The URL to fetch
    destination_dir : string
        The directory in which to place the downloaded file
    logger : Logger
        A logger to which the function will write, if provided
    access_token :
        The Earthdata Login token of the caller to use for downloads
    data : dict or Tuple[str, str]
        Optional parameter for additional data to
        send to the server when making a HTTP POST request through
        urllib.get.urlopen. These data will be URL encoded to a query string
        containing a series of `key=value` pairs, separated by ampersands. If
        None (the default), urllib.get.urlopen will use the  GET
        method.
    cfg : harmony_service_lib.util.Config
        The configuration values for this runtime environment.

    Returns
    -------
    destination : string
      The filename, including directory, of the downloaded file
    """
    if cfg is None:
        cfg = config()
    if logger is None:
        logger = build_logger(cfg)

    if _is_file_url(url):
        return _url_as_filename(url)

    source = http.localhost_url(url, cfg.localstack_host)

    destination_path = _filename(destination_dir, url)
    if destination_path.exists():
        return str(destination_path)
    destination_path = str(destination_path)

    full_user_agt = _build_full_user_agent(cfg)

    with open(destination_path, 'wb') as destination_file:
        if aws.is_s3(source):
            aws.download(cfg, source, destination_file, full_user_agt)
        elif http.is_http(source):
            http.download(cfg, source, access_token, data, destination_file, full_user_agt)
        else:
            msg = f'Unable to download a url of unknown type: {url}'
            logger.error(msg)
            raise Exception(msg)

    return destination_path


def stage(local_filename, remote_filename, mime, logger=None, location=None, cfg=None):
    """
    Stages the given local filename, including directory path, to an S3 location with the given
    filename and mime-type

    Requires the following environment variables:
        AWS_DEFAULT_REGION: The AWS region in which the S3 client is operating

    Parameters
    ----------
    local_filename : string
        A path and filename to the local file that should be staged
    remote_filename : string
        The basename to give to the remote file
    mime : string
        The mime type to apply to the staged file for use when it is served, e.g. "application/x-netcdf4"
    location : string
        The S3 prefix URL under which to place the output file.  If not provided, STAGING_BUCKET and
        STAGING_PATH must be set in the environment
    logger : logging
        The logger to use
    cfg : harmony_service_lib.util.Config
        The configuration values for this runtime environment.

    Returns
    -------
    url : string
        An s3:// URL to the staged file
    """
    # The implementation of this function has been moved to the
    # harmony_service_lib.aws module.
    if cfg is None:
        cfg = config()
    if logger is None:
        logger = build_logger(cfg)

    return aws.stage(cfg, local_filename, remote_filename, mime, logger, location)


def create_decrypter(key=b'_THIS_IS_MY_32_CHARS_SECRET_KEY_'):
    """Creates a function that will decrypt cyphertext using a shared secret
    (symmetric) 32-byte key.

    The returned decrypter function has type signature: str -> str.
    """
    box = SecretBox(key)

    def decrypter(encrypted_msg_str):
        """Decrypt encrypted text using the shared secret (symmetric) key
        in the function's closure."""

        parts = encrypted_msg_str.split(':')
        nonce = b64decode(parts[0])
        ciphertext = b64decode(parts[1])

        return box.decrypt(ciphertext, nonce).decode('utf-8')

    return decrypter


def nop_decrypter(ciphertext):
    """An identity decrypter function. A NOP: it returns the ciphertext
    as-is.
    """
    return ciphertext


def generate_output_filename(
    filename: str,
    ext: str = None,
    variable_subset: list[str] = None,
    is_regridded: bool = False,
    is_subsetted: bool = False,
    is_reformatted: bool = False
) -> str:
    """
    Return an output filename for the given granules according to our naming conventions:
    {original filename without suffix}(_{single var})?(_regridded)?(_subsetted)?(_reformatted)?.<ext>

    Parameters
    ----------
        granule : message.Granule
            The source granule for the output file
        ext: string, optional
            The destination file extension (default: original extension)
        variable_subset : string[], optional
            When variable subsetting, a list of all variables that have been subset
        is_regridded : bool, optional
            True if a regridding operation has been performed (default: False)
        is_subsetted : bool, optional
            True if a subsetting operation has been performed (default: False)
        is_reformatted : bool, optional
            True if a reformatting operation has been performed (default: False)

    Returns
    -------
        string
            The output filename
    """
    url = filename
    # Get everything between the last non-trailing '/' before the query and the first '?'
    # Do this instead of using a URL parser, because our URLs are not complex in practice and
    # it is useful to allow relative file paths to work for local testing.
    original_filename = url.split('?')[0].rstrip('/').split('/')[-1]
    decoded_original_filename = parse.unquote(original_filename)
    (original_basename, original_ext) = path.splitext(decoded_original_filename)
    if ext is None:
        ext = original_ext

    if not ext.startswith('.'):
        ext = '.' + ext

    suffixes = []
    if variable_subset and len(variable_subset) == 1:
        var = variable_subset[0]
        if hasattr(var, 'name'):
            var = var.name
        suffixes.append('_' + var)
    if is_regridded:
        suffixes.append('_regridded')
    if is_subsetted:
        suffixes.append('_subsetted')
    if is_reformatted:
        suffixes.append('_reformatted')

    suffixes.append(ext)

    result = original_basename
    # Iterate suffixes in reverse, removing them from the result if they're at the end of the string
    # This supports the case of chaining where one service regrids and another subsets but we don't
    # want names to get mangled
    for suffix in suffixes[::-1]:
        if result.endswith(suffix):
            result = result[:-len(suffix)]

    result += "".join(suffixes)

    # replace special chars that may have been encoded or present in variable_subset
    result = re.sub('\\/|:', '_', result)

    # runs of underscores are replaced with single underscore
    result = re.sub(r'_{2,}', '_', result)

    # leading or trailing underscores are removed
    result = re.sub(r'^_+|_+$', '', result)

    # underscores before or after periods are removed
    result = re.sub(r'_{0,}\._{0,}', '.', result)

    return result


def bbox_to_geometry(bbox):
    '''
    Creates a GeoJSON geometry given a GeoJSON BBox, accounting for antimeridian

    Parameters
    ----------
    bbox : float[4]
        the bounding box to create a geometry from

    Returns
    -------
    dict
        a GeoJSON Polygon or MultiPolygon representation of the input bbox
    '''
    if not bbox:
        return None
    west, south, east, north = bbox[0:4]
    if west > east:
        return {
            'type': 'MultiPolygon',
            'coordinates': [
                [[
                    [-180, south],
                    [-180, north],
                    [east, north],
                    [east, south],
                    [-180, south]
                ]],
                [[
                    [west, south],
                    [west, north],
                    [180, north],
                    [180, south],
                    [west, south]
                ]]
            ]
        }
    return {
        'type': 'Polygon',
        'coordinates': [[
            [west, south],
            [west, north],
            [east, north],
            [east, south],
            [west, south]
        ]],
    }
