"""
==================
example_service.py
==================

An example service adapter implementation and example CLI parser
"""

import argparse
import shutil
import os
from tempfile import mkdtemp
from pystac import Asset

import harmony_service_lib
from harmony_service_lib.util import generate_output_filename, stage, download

# IMPORTANT: The following line avoids making real calls to a non-existent
# Harmony frontend.  Service authors should not set this variable to "dev"
# or "test" when releasing the service.
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
            dpi = self.message.format.process('dpi')
            # Variable subsetting
            variables = source.process('variables')

            # Do the work here!
            var_names = [v.name for v in variables]
            print('Processing item %s, DPI=%d, vars=[%s]' % (item.id, dpi, ', '.join(var_names)))
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


def run_cli(args):
    """
    Runs the CLI.  Presently stubbed to demonstrate how a non-Harmony CLI fits in and allow
    future implementation or removal if desired.

    Parameters
    ----------
    args : Namespace
        Argument values parsed from the command line, presumably via ArgumentParser.parse_args

    Returns
    -------
    None
    """
    print("TODO: You can implement a non-Harmony CLI here.")
    print('To see the Harmony CLI, pass `--harmony-action=invoke '
          '--harmony-input="$(cat example/example_message.json)" '
          '--harmony-sources=example/source/catalog.json --harmony-output-dir=tmp/`')



def main():
    """
    Parses command line arguments and invokes the appropriate method to respond to them

    Returns
    -------
    None
    """
    parser = argparse.ArgumentParser(prog='example', description='Run an example service')

    harmony_service_lib.setup_cli(parser)

    args = parser.parse_args()

    if (harmony_service_lib.is_harmony_cli(args)):
        harmony_service_lib.run_cli(parser, args, ExampleAdapter)
    else:
        run_cli(args)


if __name__ == "__main__":
    main()
