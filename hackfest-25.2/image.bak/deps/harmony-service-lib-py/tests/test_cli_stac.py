import os
from tempfile import mkdtemp
from datetime import datetime
import shutil
import unittest
import json

from pystac import Catalog, CatalogType, Item

from harmony_service_lib import cli, BaseHarmonyAdapter
from harmony_service_lib.exceptions import ForbiddenException, NoDataException
from tests.util import cli_parser, config_fixture


class MockAdapter(BaseHarmonyAdapter):
    message = None
    """
    Dummy class to mock adapter calls, performing a no-op service
    """

    def invoke(self):
        MockAdapter.message = self.message
        return (self.message, self.catalog)


class MockMultiCatalogOutputAdapter(BaseHarmonyAdapter):
    message = None
    """
    Dummy class to mock adapter calls, performing a no-op service
    that returns multiple STAC catologs instead of one
    """

    def invoke(self):
        MockAdapter.message = self.message
        catalogs = [
            Catalog('a', ''), Catalog('b', ''), Catalog('c', '')]
        for cat in catalogs:
            items = [
                Item(f'item-1-from-catalog-{cat.id}', None, [0, 0, 1, 1],
                     datetime.strptime('09/19/22 13:55:26', '%m/%d/%y %H:%M:%S'), {}),
                Item(f'item-2-from-catalog-{cat.id}', None, [0, 0, 1, 2],
                     datetime.strptime('09/19/22 13:55:26', '%m/%d/%y %H:%M:%S'), {})
            ]
            cat.add_items(items)
        return (self.message, catalogs)


class TestCliInvokeAction(unittest.TestCase):
    def setUp(self):
        self.workdir = mkdtemp()
        self.inputdir = mkdtemp()
        self.config = config_fixture()
        print(self.config)

    def tearDown(self):
        MockAdapter.messages = []
        shutil.rmtree(self.workdir)

    def test_when_a_service_completes_it_writes_a_output_catalog_to_the_output_dir(self):
        with cli_parser(
                '--harmony-action', 'invoke',
                '--harmony-input', '{"test": "input"}',
                '--harmony-sources', 'example/source/catalog.json',
                '--harmony-metadata-dir', self.workdir) as parser:
            args = parser.parse_args()
            cli.run_cli(parser, args, MockAdapter, cfg=self.config)
            output = Catalog.from_file(os.path.join(self.workdir, 'catalog.json'))
            self.assertTrue(output.validate)

    def test_when_a_service_completes_it_writes_the_output_message_to_the_output_dir(self):
        with cli_parser(
                '--harmony-action', 'invoke',
                '--harmony-input', '{"test": "input"}',
                '--harmony-sources', 'example/source/catalog.json',
                '--harmony-metadata-dir', self.workdir) as parser:
            args = parser.parse_args()
            cli.run_cli(parser, args, MockAdapter, cfg=self.config)
            with open(os.path.join(self.workdir, 'message.json')) as file:
                self.assertEqual(file.read(), '{"test": "input"}')

    def test_when_the_cli_has_a_staging_location_it_overwites_the_message_staging_location(self):
        with cli_parser(
                '--harmony-action', 'invoke',
                '--harmony-input', '{"test": "input"}',
                '--harmony-sources', 'example/source/catalog.json',
                '--harmony-metadata-dir', self.workdir,
                '--harmony-data-location', 's3://fake-location/') as parser:
            args = parser.parse_args()
            cli.run_cli(parser, args, MockAdapter, cfg=self.config)
            self.assertEqual(MockAdapter.message.stagingLocation, 's3://fake-location/')
            # Does not output the altered staging location
            with open(os.path.join(self.workdir, 'message.json')) as file:
                self.assertEqual(file.read(), '{"test": "input"}')

    def test_when_the_backend_service_throws_a_known_error_it_writes_the_error_to_the_output_dir(self):
        with cli_parser(
                '--harmony-action', 'invoke',
                '--harmony-input', '{"test": "input"}',
                '--harmony-sources', 'example/source/catalog.json',
                '--harmony-metadata-dir', self.workdir) as parser:

            class MockImpl(MockAdapter):
                def invoke(self):
                    raise ForbiddenException('Something bad happened')

            args = parser.parse_args()
            with self.assertRaises(Exception) as context:
                cli.run_cli(parser, args, MockImpl, cfg=self.config)

            self.assertTrue('Something bad happened' in str(context.exception))
            with open(os.path.join(self.workdir, 'error.json')) as file:
                self.assertEqual(
                    file.read(),
                    '{"error": "Something bad happened", "category": "Forbidden", "level": "Error"}')

    def test_when_the_backend_service_throws_an_unknown_error_it_writes_a_generic_error_to_the_output_dir(self):
        with cli_parser(
                '--harmony-action', 'invoke',
                '--harmony-input', '{"test": "input"}',
                '--harmony-sources', 'example/source/catalog.json',
                '--harmony-metadata-dir', self.workdir) as parser:

            class MockImpl(MockAdapter):
                def invoke(self):
                    raise Exception('Something bad happened')

            args = parser.parse_args()
            with self.assertRaises(Exception) as context:
                cli.run_cli(parser, args, MockImpl, cfg=self.config)

            self.assertTrue('Something bad happened' in str(context.exception))
            with open(os.path.join(self.workdir, 'error.json')) as file:
                self.assertEqual(
                    file.read(),
                    '{"error": "Service request failed with an unknown error", "category": "Unknown", "level": "Error"}')

    def test_when_the_backend_service_throws_a_known_warning_it_writes_the_warning_to_the_output_dir(self):
        with cli_parser(
                '--harmony-action', 'invoke',
                '--harmony-input', '{"test": "input"}',
                '--harmony-sources', 'example/source/catalog.json',
                '--harmony-metadata-dir', self.workdir) as parser:

            class MockImpl(MockAdapter):
                def invoke(self):
                    raise NoDataException('There is no data found')

            args = parser.parse_args()
            with self.assertRaises(Exception) as context:
                cli.run_cli(parser, args, MockImpl, cfg=self.config)

            self.assertTrue('There is no data found' in str(context.exception))
            with open(os.path.join(self.workdir, 'error.json')) as file:
                self.assertEqual(
                    file.read(),
                    '{"error": "There is no data found", "category": "NoData", "level": "Warning"}')

    def test_when_multi_catalog_output_it_saves_with_particular_layout(self):
        with cli_parser(
                '--harmony-action', 'invoke',
                '--harmony-input', '{"test": "input"}',
                '--harmony-sources', 'example/source/catalog.json',
                '--harmony-metadata-dir', self.workdir) as parser:
            args = parser.parse_args()
            cli.run_cli(parser, args, MockMultiCatalogOutputAdapter, cfg=self.config)
            for idx in range(3):
                cat = Catalog.from_file(os.path.join(self.workdir, f'catalog{idx}.json'))
                cat_root = cat.get_single_link('root')
                self.assertEqual(cat_root.get_href(), f'./catalog{idx}.json')
                item_hrefs = [l.get_href() for l in cat.get_links('item')]
                self.assertTrue(f'./item-1-from-catalog-{cat.id}/item-1-from-catalog-{cat.id}.json' in item_hrefs)
                self.assertTrue(f'./item-2-from-catalog-{cat.id}/item-2-from-catalog-{cat.id}.json' in item_hrefs)
                item = Item.from_file(os.path.join(
                    self.workdir, f'./item-1-from-catalog-{cat.id}/item-1-from-catalog-{cat.id}.json'))
                item_root_href = item.get_single_link('root').get_href()
                item_parent_href = item.get_single_link('parent').get_href()
                self.assertTrue(item_parent_href == item_root_href)
                self.assertEqual(item_root_href, f'../catalog{idx}.json')
                self.assertEqual(item_parent_href, f'../catalog{idx}.json')
            with open(os.path.join(self.workdir, 'batch-count.txt')) as file:
                self.assertEqual(file.read(), '3')
            with open(os.path.join(self.workdir, 'batch-catalogs.json')) as file:
                self.assertEqual(json.loads(file.read()),
                                 ["catalog0.json",
                                  "catalog1.json",
                                  "catalog2.json"])


if __name__ == '__main__':
    unittest.main()
