"""
===========
__init__.py
===========

Convenience exports for the Harmony library
"""

# Automatically updated by `make build`
__version__ = "2.7.0"

from .adapter import BaseHarmonyAdapter
from .cli import setup_cli, is_harmony_cli, run_cli
from .message import Temporal
from pystac.stac_io import StacIO
from .s3_stac_io import S3StacIO

StacIO.set_default(S3StacIO)
