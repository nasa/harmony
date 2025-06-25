"""
======
cli.py
======

Parses CLI arguments provided by Harmony and invokes the subsetter accordingly
"""

import json
import logging
from os import path, makedirs
import datetime

from pystac import Catalog, CatalogType
from pystac.layout import BestPracticesLayoutStrategy

from harmony_service_lib.exceptions import HarmonyException
from harmony_service_lib.message import Message
from harmony_service_lib.logging import setup_stdout_log_formatting, build_logger
from harmony_service_lib.util import (config, create_decrypter)
from harmony_service_lib.version import get_version
from harmony_service_lib.aws import is_s3, write_s3
from harmony_service_lib.s3_stac_io import S3StacIO


class MultiCatalogLayoutStrategy(BestPracticesLayoutStrategy):
    """
    Layout that adheres to what the Harmony server expects
    when multiple catalogs are output by a service.
    """

    def __init__(self, index):
        self.index = index

    def get_catalog_href(self, cat, parent_dir, is_root):
        """
        Returns the catalog href, using its index number as
        part of the file name, e.g. s3://outputs/catalog0.json.

        Parameters
        ----------
        parent_dir : string
            The parent directory of the catalog
        Returns
        -------
        The catalog href, postfixed with catalog{idx}.json
        """
        return path.join(parent_dir, f'catalog{self.index}.json')


def setup_cli(parser):
    """
    Adds Harmony arguments to the CLI being parsed by the provided parser

    Parameters
    ----------
    parser : argparse.ArgumentParser
        The parser being used to parse CLI arguments
    """
    parser.add_argument('--harmony-action',
                        choices=['invoke'],
                        help=('the action Harmony needs to perform, "invoke" to run once and quit'))
    parser.add_argument('--harmony-input',
                        help=('the input data for the action provided by Harmony, required for '
                              '--harmony-action=invoke'))
    parser.add_argument('--harmony-input-file',
                        help=('the optional path to the input data for the action provided by Harmony'))
    parser.add_argument('--harmony-sources',
                        help=('file path that contains a STAC catalog with items and metadata to '
                              'be processed by the service.  Required for --harmony-action=invoke'))
    parser.add_argument('--harmony-metadata-dir',
                        help=('file path where output metadata should be written. The resulting '
                              'STAC catalog will be written to catalog.json in the supplied dir '
                              'with child resources in the same directory or a descendant '
                              'directory.  The remaining message, less any completed operations, '
                              'should be written to message.json in the supplied directory.  If '
                              'there is an error, it will be written to error.json in the supplied dir '))
    parser.add_argument('--harmony-data-location',
                        help=('the location where output data should be written, either a directory '
                              'or S3 URI prefix.  If set, overrides any value set by the message'))
    parser.add_argument('--harmony-visibility-timeout',
                        type=int,
                        default=600,
                        help=('the number of seconds the service is given to process a message '
                              'before processing is assumed to have failed'))
    parser.add_argument('--harmony-wrap-stdout',
                        action='store_const',
                        const=True,
                        help='Do not wrap STDOUT and STDERR in the Harmony log output format')


def is_harmony_cli(args):
    """
    Returns True if the passed parsed CLI arguments constitute a Harmony CLI invocation, False otherwise

    Parameters
    ----------
    args : Namespace
        Argument values parsed from the command line, presumably via ArgumentParser.parse_args

    Returns
    -------
    is_harmony_cli : bool
        True if the provided arguments constitute a Harmony CLI invocation, False otherwise
    """
    return args.harmony_action is not None


def _write_error(metadata_dir, message, category='Unknown', level='Error'):
    """
    Writes the given error message to error.json in the provided metadata dir

    Parameters
    ----------
    metadata_dir : string
        Directory into which the error should be written
    message : string
        The error message to write
    category : string
        The error category to write
    level : string
        The error level to write, can be 'Error' or 'Warning'. Default to 'Error'
    """
    error_data = {'error': message, 'category': category, 'level': level}
    if is_s3(metadata_dir):
        json_str = json.dumps(error_data)
        write_s3(f'{metadata_dir}error.json', json_str)
    else:
        with open(path.join(metadata_dir, 'error.json'), 'w') as file:
            json.dump(error_data, file)


def _build_adapter(AdapterClass, message_string, sources_path, data_location, config):
    """
    Creates the adapter to be invoked for the given harmony_service_lib input

    Parameters
    ----------
    AdapterClass : class
        The BaseHarmonyAdapter subclass to use to handle service invocations
    message_string : string
        The Harmony input message
    sources_path : string
        A file location containing a STAC catalog corresponding to the input message sources
    data_location : string
        The name of the directory where output should be written
    config : harmony_service_lib.util.Config
        A configuration instance for this service
    Returns
    -------
        BaseHarmonyAdapter subclass instance
            The adapter to be invoked
    """
    catalog = Catalog.from_file(sources_path) if bool(sources_path) else None

    secret_key = config.shared_secret_key

    if bool(secret_key):
        decrypter = create_decrypter(bytes(secret_key, 'utf-8'))
    else:
        def identity(arg):
            return arg
        decrypter = identity

    message = Message(json.loads(message_string), decrypter)
    if data_location:
        message.stagingLocation = data_location
    adapter = AdapterClass(message, catalog)
    adapter.set_config(config)

    return adapter


def _invoke(adapter, metadata_dir):
    """
    Handles --harmony-action=invoke by invoking the adapter for the given input message

    Parameters
    ----------
    adapter : BaseHarmonyAdapter
        The BaseHarmonyAdapter subclass to use to handle service invocations
    metadata_dir : string
        The name of the directory where STAC and message output should be written
    Returns
    -------
    True if the operation completed successfully, False otherwise
    """
    try:
        logging.info(f'Invoking adapter with harmony-service-lib-py version {get_version()}')
        s3_io = S3StacIO()
        is_s3_metadata_dir = is_s3(metadata_dir)
        if not is_s3_metadata_dir:
            makedirs(metadata_dir, exist_ok=True)
        (out_message, stac_output) = adapter.invoke()
        if isinstance(stac_output, list):
            for idx, catalog in enumerate(stac_output):
                catalog.normalize_and_save(metadata_dir, CatalogType.SELF_CONTAINED, MultiCatalogLayoutStrategy(idx))
            json_str = json.dumps([f'catalog{i}.json' for i, c in enumerate(stac_output)])
            s3_io.write_text(path.join(metadata_dir, 'batch-catalogs.json'), json_str)
            s3_io.write_text(path.join(metadata_dir, 'batch-count.txt'), f'{len(stac_output)}')
        else:  # assume stac_output is a single catalog
            stac_output.normalize_and_save(metadata_dir, CatalogType.SELF_CONTAINED)

        if not is_s3_metadata_dir:
            with open(path.join(metadata_dir, 'message.json'), 'w') as file:
                json.dump(out_message.output_data, file)
    except HarmonyException as err:
        logging.error(err, exc_info=1)
        _write_error(metadata_dir, err.message, err.category, err.level)
        raise
    except BaseException as err:
        logging.error(err, exc_info=1)
        _write_error(metadata_dir, 'Service request failed with an unknown error')
        raise


def run_cli(parser, args, AdapterClass, cfg=None):
    """
    Runs the Harmony CLI invocation captured by the given args

    Parameters
    ----------
    parser : argparse.ArgumentParser
        The parser being used to parse CLI arguments, used to provide CLI argument errors
    args : Namespace
        Argument values parsed from the command line, presumably via ArgumentParser.parse_args
    AdapterClass : class
        The BaseHarmonyAdapter subclass to use to handle service invocations
    cfg : harmony_service_lib.util.Config
        A configuration instance for this service
    """
    if cfg is None:
        cfg = config()
    if args.harmony_wrap_stdout:
        setup_stdout_log_formatting(cfg)

    # read in the operation file passed in with --harmony-input-file if any
    if bool(args.harmony_input_file):
        with open(args.harmony_input_file, 'r') as f:
            args.harmony_input = f.read()

    if args.harmony_action == 'invoke':
        start_time = datetime.datetime.now()
        if not bool(args.harmony_input):
            parser.error(
                '--harmony-input or --harmony-input-file must be provided for --harmony-action=invoke')
        elif not bool(args.harmony_metadata_dir):
            parser.error(
                '--harmony-metadata-dir must be provided for --harmony-action=invoke')
        else:
            adapter = None
            try:
                adapter = _build_adapter(AdapterClass,
                                         args.harmony_input,
                                         args.harmony_sources,
                                         args.harmony_data_location,
                                         cfg)
                adapter.logger.info(f'timing.{cfg.app_name}.start')
                _invoke(adapter, args.harmony_metadata_dir)
            finally:
                time_diff = datetime.datetime.now() - start_time
                duration_ms = int(round(time_diff.total_seconds() * 1000))
                duration_logger = build_logger(cfg)
                extra_fields = {
                    'user': (
                        adapter.message.user
                        if adapter and adapter.message and hasattr(adapter.message, "user")
                        else ''
                    ),
                    'requestId': (
                        adapter.message.requestId
                        if adapter and adapter.message and hasattr(adapter.message, "requestId")
                        else ''
                    ),
                    'durationMs': duration_ms
                }
                duration_logger.info(f'timing.{cfg.app_name}.end', extra=extra_fields)
