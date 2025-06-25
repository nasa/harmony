"""
This module includes various AWS-specific functions to stage data in S3.

This module relies on the harmony_service_lib.util.config and its environment variables to be
set for correct operation. See that module and the project README for details.
"""
from urllib.parse import urlparse
from os import environ
import boto3
from botocore.config import Config
from harmony_service_lib import util


def is_s3(url: str) -> bool:
    """Predicate to determine if a url is an S3 endpoint."""
    return url is not None and url.lower().startswith('s3')


def aws_parameters(use_localstack, localstack_host, region):
    """Constructs a configuration dict that can be used to create an aws client.

    Parameters
    ----------
    use_localstack : bool
        Whether to use the localstack in this environment.
    localstack_host : str
        The hostname of the localstack services (if use_localstack enabled).
    region : str
        The AWS region to connect to.
    Returns
    -------

    """
    if use_localstack:
        return {
            'endpoint_url': f'http://{localstack_host}:4566',
            'use_ssl': False,
            'aws_access_key_id': 'ACCESS_KEY',
            'aws_secret_access_key': 'SECRET_KEY',
            'region_name': region
        }
    else:
        return {
            'region_name': region
        }


def write_s3(url, txt):
    """
    Writes text to the given  s3 url.

    Parameters
    ----------
    url: The s3 file url.
    txt: The file contents.
    """
    parsed = urlparse(url)
    config = util.config(validate=environ.get('ENV') != 'test')
    service_params = aws_parameters(
            config.use_localstack, config.localstack_host, config.aws_default_region)
    bucket = parsed.netloc
    key = parsed.path[1:]
    s3 = boto3.resource("s3", **service_params)
    s3.Object(bucket, key).put(Body=txt)


def _get_aws_client(config, service, user_agent=None):
    """
    Returns a boto3 client for accessing the provided service.  Accesses the service in us-west-2
    unless "AWS_DEFAULT_REGION" is set.  If the environment variable "USE_LOCALSTACK" is set to "true",
    it will return a client that will access a LocalStack instance instead of AWS.

    Parameters
    ----------
    config : harmony_service_lib.util.Config
        The configuration for the current runtime environment.
    service : string
        The AWS service name for which to construct a client, e.g. "s3"
    user_agent : string
        The user agent that is requesting the aws service.
        E.g. harmony/0.0.0 (harmony-sit) harmony-service-lib/4.0 (gdal-subsetter)

    Returns
    -------
    s3_client : boto3.*.Client
        A client appropriate for accessing the provided service
    """
    boto_cfg = Config(user_agent_extra=user_agent)
    service_params = aws_parameters(config.use_localstack, config.localstack_host, config.aws_default_region)

    return boto3.client(service_name=service, config=boto_cfg, **service_params)


def download(config, url, destination_file, user_agent=None):
    """Download an S3 object to the specified destination directory.

    Parameters
    ----------
    config : harmony_service_lib.util.Config
        The configuration for the current runtime environment.
    destination_file : file-like
        The destination file where the object will be written. Must be
        a file-like object opened for binary write.
    user_agent : string
        The user agent that is requesting the download.
        E.g. harmony/0.0.0 (harmony-sit) harmony-service-lib/4.0 (gdal-subsetter)
    """
    bucket = url.split('/')[2]
    key = '/'.join(url.split('/')[3:])
    aws_client = _get_aws_client(config, 's3', user_agent)
    aws_client.download_fileobj(bucket, key, destination_file)


def stage(config, local_filename, remote_filename, mime, logger, location=None):
    """
    Stages the given local filename, including directory path, to an S3 location with the given
    filename and mime-type

    Requires the following environment variables:
        AWS_DEFAULT_REGION: The AWS region in which the S3 client is operating

    Parameters
    ----------
    config : harmony_service_lib.util.Config
        The configuration for the current runtime environment.
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

    Returns
    -------
    url : string
        An s3:// URL to the staged file
    """
    key = None
    staging_bucket = config.staging_bucket

    if location is None:
        if config.staging_path:
            key = '%s/%s' % (config.staging_path, remote_filename)
        else:
            key = remote_filename
    else:
        _, _, staging_bucket, staging_path = location.split('/', 3)
        key = staging_path + remote_filename

    if config.env in ['dev', 'test'] and not config.use_localstack:
        logger.warning(f"ENV={config.env}"
                       f" and not using localstack, so we will not stage {local_filename} to {key}")
        return "http://example.com/" + key

    s3 = _get_aws_client(config, 's3')
    s3.upload_file(local_filename, staging_bucket, key, ExtraArgs={'ContentType': mime})

    return 's3://%s/%s' % (staging_bucket, key)
