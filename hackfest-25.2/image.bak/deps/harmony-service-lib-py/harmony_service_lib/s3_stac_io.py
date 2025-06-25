from urllib.parse import urlparse
import boto3
from pystac.stac_io import StacIO, DefaultStacIO
from harmony_service_lib import util
from harmony_service_lib import aws
from os import environ

"""
Read and write to s3 when STAC links start with s3://.
https://pystac.readthedocs.io/en/latest/concepts.html#using-stac-io
"""

defaultStacIO = DefaultStacIO()


class S3StacIO(StacIO):

    def read_text(self, uri):
        """
        Reads STAC files from s3
        (or via the default method if the protocol is not s3).

        Parameters
        ----------
        uri: The STAC file uri.

        Returns
        -------
        The file contents
        """
        config = util.config(validate=environ.get('ENV') != 'test')
        service_params = aws.aws_parameters(
            config.use_localstack, config.localstack_host, config.aws_default_region)
        parsed = urlparse(uri)
        if parsed.scheme == 's3':
            bucket = parsed.netloc
            key = parsed.path[1:]
            s3 = boto3.resource('s3', **service_params)
            obj = s3.Object(bucket, key)
            return obj.get()['Body'].read().decode('utf-8')
        else:
            return defaultStacIO.read_text(uri)

    def write_text(self, uri, txt):
        """
        Writes a STAC file to the given uri.

        Parameters
        ----------
        uri: The STAC file uri.
        txt: The STAC contents.
        """
        parsed = urlparse(uri)
        if parsed.scheme == 's3':
            aws.write_s3(uri, txt)
        else:
            defaultStacIO.write_text(uri, txt)
