import json
import argparse
import requests
import shutil
import os
from urllib.parse import urljoin, urlparse
from typing import Dict, Union
from tempfile import mkdtemp
from pystac import Asset
import harmony_service_lib
from harmony_service_lib.util import generate_output_filename, stage, download

os.environ['ENV'] = 'dev'

class ExampleAdapter(harmony_service_lib.BaseHarmonyAdapter):
    """
    Shows an example of what a service adapter implementation looks like
    """
    def process_item(self, item, source):
        """
        Processes a single input item.  Services that are not aggregating multiple input files
        should prefer to implement this method rather than #invoke

        This example copies its input to the output, marking "dpi" and "variables" message
        attributes as having been processed

        Parameters
        ----------
        item : pystac.Item
            the item that should be processed
        source : harmony.message.Source
            the input source defining the variables, if any, to subset from the item

        Returns
        -------
        pystac.Item
            a STAC catalog whose metadata and assets describe the service output
        """
        result = item.clone()
        result.assets = {}

        # Create a temporary dir for processing we may do
        workdir = mkdtemp()
        try:
            # Get the data file
            asset = next(v for k, v in item.assets.items() if 'data' in (v.roles or []))
            input_filename = download(asset.href, workdir, logger=self.logger, access_token=self.message.accessToken)

            # Mark any fields the service processes so later services do not repeat work
            # dpi = self.message.format.process('dpi')
            # Variable subsetting
            # variables = source.process('variables')

            # Do the work here!
            # var_names = [v.name for v in variables]
            print('Processing item %s', item.id)
            working_filename = os.path.join(workdir, 'tmp.txt')
            shutil.copyfile(input_filename, working_filename)

            # Stage the output file with a conventional filename
            output_filename = generate_output_filename(asset.href, ext=None, variable_subset=None,
                                                       is_regridded=False, is_subsetted=False)
            url = stage(working_filename, output_filename, 'text/plain', location=self.message.stagingLocation,
                        logger=self.logger)

            # Update the STAC record
            result.assets['data'] = Asset(url, title=output_filename, media_type='text/plain', roles=['data'])
            # Other metadata updates may be appropriate, such as result.bbox and result.geometry
            # if a spatial subset was performed

            # Return the STAC record
            return result
        finally:
            # Clean up any intermediate resources
            shutil.rmtree(workdir)


def get_stac_location(item: Dict[str, Union[int, str]], target_url: str = '', is_aggregate: bool = False) -> str:
    """
    Get the STAC location URL for an item.

    Args:
        item: Dictionary with 'id' (int) and 'jobID' (str) keys
        target_url: The target URL to resolve (default: '')
        is_aggregate: Whether this is an aggregate item (default: False)

    Returns:
        The resolved STAC location URL
    """
    # Get artifact bucket from environment variable
    artifact_bucket = os.environ.get('ARTIFACT_BUCKET', '')

    # Build the base URL
    aggregate_prefix = 'aggregate-' if is_aggregate else ''
    base_url = f"s3://{artifact_bucket}/{item['jobID']}/{aggregate_prefix}{item['id']}/outputs/"

    return base_url


def handler(event, context):
  print(event)
  records = event['Records']

  workItem = records[0]['body']['workItem']

  operation = workItem['operation']
  stac_catalog_location = workItem['stacCatalogLocation']
  catalog_dir = get_stac_location(workItem)

  operation_json = json.dumps(operation)
  operation_command_line = '--harmony-input'
  operation_command_line_value = operation_json

  arg_string = [
      "--harmony-action",
      "invoke",
      "--harmony-input",
      operation_command_line_value,
      "--harmony-sources",
      stac_catalog_location,
       "--harmony-metadata-dir",
       catalog_dir
  ]

  parser = argparse.ArgumentParser(prog='example', description='Run an example service')

  harmony_service_lib.setup_cli(parser)

  args = parser.parse_args(arg_string)

  harmony_service_lib.run_cli(parser, args, ExampleAdapter)

  # parse result and return
  workItem['status'] = 'successful'
  workItem['results'] = [f"{catalog_dir}catalog.json"]
  # workItem['totalItemsSize'] = totalItemsSize;
  # workItem['outputItemSizes'] = outputItemSizes;

  response = requests.put(f"{os.environ['CALLBACK_URL_ROOT']}/service/work/{workItem['id']}", json=workItem)
  response.raise_for_status()
