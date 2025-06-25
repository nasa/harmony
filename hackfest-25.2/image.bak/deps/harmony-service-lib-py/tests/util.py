import argparse
import sys
from unittest.mock import patch
from contextlib import contextmanager

from harmony_service_lib import cli, util

def cli_test(*cli_args):
    """
    Decorator that takes a list of CLI parameters, patches them into
    sys.argv and passes a parser into the wrapped method
    """
    def cli_test_wrapper(func):
        def wrapper(self):
            with cli_parser(*cli_args) as parser:
                func(self, parser)
        return wrapper
    return cli_test_wrapper


@contextmanager
def cli_parser(*cli_args):
    """
    Returns a parser for the given CLI args

    Returns
    -------
    argparse.ArgumentParser
        the parser for the given CLI args
    """
    with patch.object(sys, 'argv', ['example'] + list(cli_args)):
        parser = argparse.ArgumentParser(
            prog='example', description='Run an example service')
        cli.setup_cli(parser)
        yield parser


def config_fixture(use_localstack=False,
                   staging_bucket='UNKNOWN',
                   staging_path='UNKNOWN',
                   user_agent=None,
                   app_name=None,
                   text_logger=False,
                   max_download_retries=5,
                   post_url_length=2000):
    c = util.config(validate=False)
    return util.Config(
        # Override
        use_localstack=use_localstack,
        staging_path=staging_path,
        staging_bucket=staging_bucket,
        app_name=app_name,
        text_logger=text_logger,
        max_download_retries=max_download_retries,
        post_url_length=post_url_length,
        # Default
        env=c.env,
        backend_host=c.backend_host,
        localstack_host=c.localstack_host,
        aws_default_region=c.aws_default_region,
        shared_secret_key=c.shared_secret_key,
        # Override if provided, else default
        user_agent=c.user_agent if user_agent is None else user_agent
    )
