"""
Utility functions to download data from backend data sources so it can be operated on
locally.

When downloading from an EDL-token aware data source, this module uses EDL shared /
federated token authentication.

This module relies on the harmony_service_lib.util.config and its environment variables to be
set for correct operation. See that module and the project README for details.
"""

from functools import lru_cache
import json
from time import sleep
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
import datetime
import sys
import os
import re
from harmony_service_lib.earthdata import EarthdataAuth, EarthdataSession
from harmony_service_lib.exceptions import ServerException, ForbiddenException
from harmony_service_lib.logging import build_logger

# Timeout in seconds.  Per requests docs, this is not a time limit on
# the entire response download; rather, an exception is raised if the
# server has not issued a response for timeout seconds (more
# precisely, if no bytes have been received on the underlying socket
# for timeout seconds).  See:
# https://2.python-requests.org/en/master/user/quickstart/#timeouts
TIMEOUT = 60

MAX_RETRY_DELAY_SECS = 90

# `request_context` is used to provide information about the request to functions like `download`
# without adding extra function arguments
request_context = {}


def get_retry_delay(retry_num: int, max_delay: int = MAX_RETRY_DELAY_SECS) -> int:
    """The number of seconds to sleep before retrying. Exponential backoff starting
    from 5 seconds up the max_delay. So with a max delay of 60 the retry periods
    would be 5, 10, 20, 40, 60, ..., 60.

    Parameters
        ----------
        retry_num : int
            The current number of times this request has been retried
        max_delay: int
            The maximum number of seconds to wait before retrying
        Returns
        -------
        int : The number of seconds to wait before retrying
    """
    return min(max_delay, 2.5 * (2 ** retry_num))


def is_http(url: str) -> bool:
    """Predicate to determine if the url is an http endpoint.

    Parameters
    ----------
    url : str
        The URL to check

    Returns
    -------
    bool
        Whether the URL is an http endpoint.

    """
    return url is not None and urlparse(url).scheme in ['http', 'https']


def localhost_url(url, local_hostname):
    """Return a version of the url optimized for local development.

    If the url includes the string `localhost`, it will be replaced by
    the `local_hostname`.

    Parameters
    ----------
    url : str
        The url to check
    Returns
    -------
    str : The url, possibly converted to use a different local hostname
    """
    return url.replace('localhost', local_hostname)


def _is_eula_error(body: str) -> bool:
    """
    Tries to determine if the exception is due to a EULA that the user needs to
    approve, and if so, returns a response with the url where they can do so.

    Parameters
    ----------
    body: The body JSON string that may contain the EULA details.

    Returns
    -------
    A boolean indicating if the body contains a EULA error
    """
    try:
        json_object = json.loads(body)
        return "error_description" in json_object and "resolution_url" in json_object
    except Exception:
        return False


def _eula_error_message(body: str) -> str:
    """
    Constructs a user-friendly error indicating the required EULA
    acceptance and the URL where the user can do so.

    Parameters
    ----------
    body: The body JSON string that may contain the EULA details.

    Returns
    -------
    The string with the EULA message
    """
    json_object = json.loads(body)
    return (f"Request could not be completed because you need to agree to the EULA "
            f"at {json_object['resolution_url']}")


@lru_cache(maxsize=128)
def _earthdata_session():
    """Constructs an EarthdataSession for use to download one or more files."""
    return EarthdataSession()


def _add_api_request_uuid(url):
    request_id = request_context.get('request_id')

    if request_id is None:
        return url

    # Parse the URL into components
    parsed_url = urlparse(url)

    # only add the request_id if this is an http/https url
    if parsed_url.scheme != 'http' and parsed_url.scheme != 'https':
        return url

    # Extract the current query parameters from the URL
    query_params = parse_qs(parsed_url.query)

    # Add or update the 'request_id' parameter
    query_params['A-api-request-uuid'] = request_id

    # Convert the query parameters back to a string
    query_string = urlencode(query_params, doseq=True)

    # Rebuild the URL with the new query string
    new_url = urlunparse(
        (parsed_url.scheme, parsed_url.netloc, parsed_url.path,
         parsed_url.params, query_string, parsed_url.fragment)
    )

    return new_url


def _download(
    config, url: str,
    access_token: str,
    data,
    total_retries: int,
    logger, user_agent=None,
    **kwargs_download_agent
):
    """Implements the download functionality.

    Using the EarthdataSession and EarthdataAuth extensions to the
    `requests` module, this function will download the given url.

    Parameters
    ----------
    config : harmony_service_lib.util.Config
        The configuration for the current runtime environment.
    url : str
        The url for the resource to download
    access_token : str
        A shared EDL access token created from the user's access token
        and the app identity.
    data : dict or Tuple[str, str]
        Optional parameter for additional data to send to the server
        when making an HTTP POST request. These data will be URL
        encoded to a query string containing a series of `key=value`
        pairs, separated by ampersands. If None (the default), the
        request will be sent with an HTTP GET request.
    total_retries: int
        Upper limit on the number of times to retry the request
    user_agent : str
        The user agent that is requesting the download.
        E.g. harmony/0.0.0 (harmony-sit) harmony-service-lib/4.0 (gdal-subsetter)
    kwargs_download_agent: dict
        kwargs to be passed to the download agent
        E.g. stream=True

    Returns
    -------
    requests.Response with the download result

    """
    headers = {}
    if user_agent is not None:
        headers['user-agent'] = user_agent
    auth = EarthdataAuth(access_token)
    tries = 0
    retry = True
    response = None
    download_url = None
    while retry is True:
        retry = False
        tries += 1
        try:
            session = _earthdata_session()
            session.auth = auth
            if data is None and len(url) > config.post_url_length:
                parsed_url = urlparse(url)
                data = parsed_url.query
                download_url = f"{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path}"

            if data is None:
                response = session.get(url, headers=headers, timeout=TIMEOUT, **kwargs_download_agent)
                if response.ok:
                    return response
                else:
                    raise Exception(f'Unable to download due to status code: {response.status_code} \
                        and content {response.content}')
            else:
                # Including this header since the stdlib does by default,
                # but we've switched to `requests` which does not.
                headers['Content-Type'] = 'application/x-www-form-urlencoded'
                response = session.post(
                    download_url if download_url is not None else url,
                    headers=headers,
                    data=data,
                    timeout=TIMEOUT,
                    **kwargs_download_agent)
                if response.ok:
                    return response
                else:
                    raise Exception(f'Unable to download due to status code: {response.status_code} \
                        and content {response.content}')

        except Exception:
            if response is not None and _is_eula_error(response.content):
                msg = _eula_error_message(response.content)
                logger.info(f'{msg} due to: {response.content}')
                return response

            if response is not None and response.status_code in (401, 403):
                msg = f'Forbidden: Unable to download {url}. Will not retry.'
                logger.info(f'{msg} due to: {response.content}')
                return response

            if tries < total_retries:
                retry = True
                delay = get_retry_delay(tries)
                logger.exception(f'Retrying failed download {url}')
                sleep(delay)
            else:
                logger.error(f'All retries exhaused for downloading {url}')
                return response


def _log_download_performance(logger, url, duration_ms, file_size):
    """Logs a message tracking performance information related to a file download.

    Parameters
    ----------
    logger : logging.Logger
        The logger to use.
    url : str
        The url for the resource to download
    duration_ms: int
        The number of milliseconds the download took
    file_size: int
        The size of the downloaded file
    """
    host = 'Unknown'
    url_path = ''
    try:
        match = re.search('.*://([^/]+)(.*)', url)
        if match:
            host = match.group(1)
            url_path = match.group(2)
    except Exception:
        logger.exception(f'Unable to extract host name from {url}')
    extra_fields = {
        'durationMs': duration_ms,
        'host': host,
        "path": url_path,
        "size": file_size
    }
    logger.info('timing.download.end', extra=extra_fields)


def download(config, url: str, access_token: str, data, destination_file,
             user_agent=None, stream=True, buffer_size=1024*1024*16):
    """Downloads the given url using the provided EDL user access token
    and writes it to the provided file-like object.

    Exception cases:
    1. No user access token
    2. Invalid user access token
    3. Unable to authenticate the user with Earthdata Login
       a. User credentials (could happen even after token validation
       b. Application credentials
    4. Error response when downloading
    5. Data requires EULA acceptance by user

    Parameters
    ----------
    config : harmony_service_lib.util.Config
        The configuration for the current runtime environment.
    url : str
        The url for the resource to download
    access_token : str
        A shared EDL access token created from the user's access token
        and the app identity.
    data : dict or Tuple[str, str]
        Optional parameter for additional data to send to the server
        when making an HTTP POST request. These data will be URL
        encoded to a query string containing a series of `key=value`
        pairs, separated by ampersands. If None (the default), the
        request will be sent with an HTTP GET request.
    destination_file : file-like
        The destination file where the data will be written. Must be
        a file-like object opened for binary write.
    user_agent : str
        The user agent that is requesting the download.
        E.g. harmony/0.0.0 (harmony-sit) harmony-service-lib/4.0 (gdal-subsetter)

    Returns
    -------
    requests.Response with the download result

    Side-effects
    ------------
    Will write to provided destination_file
    NOTE: streaming request is used to download the file,
          and the chunksize is defaulted to 16MB based on the experiment with a large file of 1.8Gb
          for optimized speed and memory consumption.
          If you are experiencing some performance decay for high-throughput small-sized granules,
          you may want to set stream=False.
    """

    response = None
    logger = build_logger(config)
    # Add the request ID to the download url so it can be used by Cloud Metrics
    url = _add_api_request_uuid(url)
    start_time = datetime.datetime.now()
    logger.info(f'timing.download.start {url}')

    if (not stream) and buffer_size:
        logger.warn(
            f"In download paramters, buffer_size={buffer_size} will be ignored since stream is set to be {stream}."
        )
    elif stream and not isinstance(buffer_size, int):
        raise Exception(f"In download parameters: buffer_size must be integer when stream={stream}.")

    if access_token is not None:
        response = _download(
            config, url, access_token, data, config.max_download_retries, logger, user_agent, stream=stream
        )

    if response is not None and response.ok:
        if not stream:
            destination_file.write(response.content)
            file_size = sys.getsizeof(response.content)
        else:
            for chunk in response.iter_content(chunk_size=buffer_size):
                destination_file.write(chunk)
            file_size = os.path.getsize(destination_file.name)
        time_diff = datetime.datetime.now() - start_time
        duration_ms = int(round(time_diff.total_seconds() * 1000))
        duration_logger = build_logger(config)
        _log_download_performance(duration_logger, url, duration_ms, file_size)

        return response

    if _is_eula_error(response.content):
        msg = _eula_error_message(response.content)
        logger.info(f'{msg} due to: {response.content}')
        raise ForbiddenException(msg)

    if response.status_code in (401, 403):
        msg = f'Forbidden: Unable to download {url}'
        logger.info(f'{msg} due to: {response.content}')
        raise ForbiddenException(msg)

    msg = f'Unable to download due to status code: {response.status_code} and content \
        {response.content} and all retries exhausted.'
    logger.error(msg)
    raise ServerException(msg)
