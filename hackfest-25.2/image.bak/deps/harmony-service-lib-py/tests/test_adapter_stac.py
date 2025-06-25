"""
Tests STAC-based invocation styles and methods on BaseHarmonyAdapter
"""

import unittest

from unittest.mock import patch
from pystac import Catalog, Item, Link

from harmony_service_lib.message import Message
from harmony_service_lib.adapter import BaseHarmonyAdapter
from .example_messages import full_message
from .util import config_fixture


# Minimal concrete implementation that records method calls
class AdapterTester(BaseHarmonyAdapter):
    process_args = []

    def process_item(self, item, source):
        AdapterTester.process_args.append((item, source))
        if item.id == 'mutate-me':
            item.id = 'i-mutated-you'
        return item


class TestBaseHarmonyAdapterDefaultInvoke(unittest.TestCase):
    def setUp(self):
        AdapterTester.process_args = []
        self.config = config_fixture()

    def test_items_with_no_input_source_raise_exceptions(self):
        catalog = Catalog('0', 'Catalog 0')
        catalog.add_item(Item('1', None, [0, 0, 1, 1], '2020-01-01T00:00:00.000Z', {}))
        adapter = AdapterTester(Message(full_message), catalog, config=self.config)
        self.assertRaises(RuntimeError, adapter.invoke)

    def test_invocation_processes_items_with_sources(self):
        catalog = Catalog('0', 'Catalog 0')
        catalog.add_link(Link('harmony_source', 'http://example.com/C0001-EXAMPLE'))

        message = Message(full_message)
        items = [
            Item('1', None, [0, 0, 1, 1], '2020-01-01T00:00:00.000Z', {}),
            Item('2', None, [0, 0, 1, 2], '2020-01-01T00:00:00.000Z', {})
        ]
        catalog.add_items(items)
        adapter = AdapterTester(message, catalog, config=self.config)
        adapter.invoke()
        self.assertEqual(AdapterTester.process_args[0][0].bbox, items[0].bbox)
        self.assertEqual(AdapterTester.process_args[1][0].bbox, items[1].bbox)
        self.assertEqual(AdapterTester.process_args[0][1], message.sources[0])
        self.assertEqual(AdapterTester.process_args[1][1], message.sources[0])

    @patch('harmony_service_lib.adapter.read_file')
    def test_invocation_follows_linked_catalogs(self, test_patch):
        catalog0 = Catalog('0', 'Catalog 0')
        catalog0.add_link(Link('harmony_source', 'http://example.com/C0001-EXAMPLE'))
        catalog1 = Catalog('1', 'Catalog 1')
        catalog1.add_link(Link('harmony_source', 'http://example.com/C0002-EXAMPLE'))
        catalog0.add_link(Link('next', 'catalog1.json'))
        test_patch.return_value = catalog1
        message = Message(full_message)
        items_a = [
            Item('3', None, [0, 0, 1, 3], '2020-01-01T00:00:00.000Z', {}),
            Item('4', None, [0, 0, 1, 4], '2020-01-01T00:00:00.000Z', {})
        ]
        items_b = [
            Item('5', None, [0, 0, 1, 5], '2020-01-01T00:00:00.000Z', {}),
            Item('6', None, [0, 0, 1, 6], '2020-01-01T00:00:00.000Z', {})
        ]
        catalog0.add_items(items_a)
        catalog1.add_items(items_b)
        adapter = AdapterTester(message, catalog0, config=self.config)
        adapter.invoke()
        self.assertEqual(AdapterTester.process_args[0][0].bbox, items_a[0].bbox)
        self.assertEqual(AdapterTester.process_args[1][0].bbox, items_a[1].bbox)
        self.assertEqual(AdapterTester.process_args[2][0].bbox, items_b[0].bbox)
        self.assertEqual(AdapterTester.process_args[3][0].bbox, items_b[1].bbox)

    def test_invocation_recurses_subcatalogs(self):
        catalog = Catalog('0', 'Catalog 0')
        catalog.add_link(Link('harmony_source', 'http://example.com/C0001-EXAMPLE'))
        catalog.add_child(Catalog('1a', 'Catalog 1a'))
        subcatalog = Catalog('1b', 'Catalog 1b')
        catalog.add_child(subcatalog)
        subsubcatalog_a = Catalog('2a', 'Catalog 2a')
        subsubcatalog_b = Catalog('2b', 'Catalog 2b')
        subsubcatalog_b.add_link(Link('harmony_source', 'http://example.com/C0002-EXAMPLE'))
        subcatalog.add_children([subsubcatalog_a, subsubcatalog_b])

        message = Message(full_message)
        items_a = [
            Item('3', None, [0, 0, 1, 3], '2020-01-01T00:00:00.000Z', {}),
            Item('4', None, [0, 0, 1, 4], '2020-01-01T00:00:00.000Z', {})
        ]
        items_b = [
            Item('5', None, [0, 0, 1, 5], '2020-01-01T00:00:00.000Z', {}),
            Item('6', None, [0, 0, 1, 6], '2020-01-01T00:00:00.000Z', {})
        ]
        subsubcatalog_a.add_items(items_a)
        subsubcatalog_b.add_items(items_b)
        adapter = AdapterTester(message, catalog, config=self.config)
        adapter.invoke()
        self.assertEqual(AdapterTester.process_args[0][0].bbox, items_a[0].bbox)
        self.assertEqual(AdapterTester.process_args[1][0].bbox, items_a[1].bbox)
        self.assertEqual(AdapterTester.process_args[2][0].bbox, items_b[0].bbox)
        self.assertEqual(AdapterTester.process_args[3][0].bbox, items_b[1].bbox)
        self.assertEqual(AdapterTester.process_args[0][1], message.sources[0])
        self.assertEqual(AdapterTester.process_args[1][1], message.sources[0])
        self.assertEqual(AdapterTester.process_args[2][1], message.sources[1])
        self.assertEqual(AdapterTester.process_args[3][1], message.sources[1])

    @patch('harmony_service_lib.adapter.read_file')
    def test_get_all_items_follows_links(self, test_patch):
        catalog0 = Catalog('0', 'Catalog 0')
        catalog0.add_link(Link('harmony_source', 'http://example.com/C0001-EXAMPLE'))
        catalog1 = Catalog('1', 'Catalog 1')
        catalog1.add_link(Link('harmony_source', 'http://example.com/C0002-EXAMPLE'))
        catalog0.add_link(Link('next', 'catalog1.json'))
        catalog1.add_link(Link('prev', 'catalog0.json'))
        test_patch.return_value = catalog1
        message = Message(full_message)
        items_a = [
            Item('3', None, [0, 0, 1, 3], '2020-01-01T00:00:00.000Z', {}),
            Item('4', None, [0, 0, 1, 4], '2020-01-01T00:00:00.000Z', {})
        ]
        items_b = [
            Item('5', None, [0, 0, 1, 5], '2020-01-01T00:00:00.000Z', {}),
            Item('6', None, [0, 0, 1, 6], '2020-01-01T00:00:00.000Z', {})
        ]
        catalog0.add_items(items_a)
        catalog1.add_items(items_b)
        adapter = AdapterTester(message, catalog0, config=self.config)
        default_items = list(adapter.get_all_catalog_items(catalog0))
        self.assertEqual(default_items, [ *items_a, *items_b ])
        all_items = list(adapter.get_all_catalog_items(catalog0, True))
        self.assertEqual(all_items, [ *items_a, *items_b ])
        no_link_items = list(adapter.get_all_catalog_items(catalog0, False))
        self.assertEqual(no_link_items, items_a)

    @patch('harmony_service_lib.adapter.read_file')
    def test_get_all_items_handles_children(self, test_patch):
        catalog = Catalog('0', 'Catalog 0')
        catalog.add_link(Link('harmony_source', 'http://example.com/C0001-EXAMPLE'))
        catalog.add_child(Catalog('1a', 'Catalog 1a'))
        subcatalog = Catalog('1b', 'Catalog 1b')
        catalog.add_child(subcatalog)
        subsubcatalog_a = Catalog('2a', 'Catalog 2a')
        subsubcatalog_b = Catalog('2b', 'Catalog 2b')
        subsubcatalog_b.add_link(Link('harmony_source', 'http://example.com/C0002-EXAMPLE'))
        subcatalog.add_children([subsubcatalog_a, subsubcatalog_b])

        message = Message(full_message)
        items_a = [
            Item('3', None, [0, 0, 1, 3], '2020-01-01T00:00:00.000Z', {}),
            Item('4', None, [0, 0, 1, 4], '2020-01-01T00:00:00.000Z', {})
        ]
        items_b = [
            Item('5', None, [0, 0, 1, 5], '2020-01-01T00:00:00.000Z', {}),
            Item('6', None, [0, 0, 1, 6], '2020-01-01T00:00:00.000Z', {})
        ]
        subsubcatalog_a.add_items(items_a)
        subsubcatalog_b.add_items(items_b)
        adapter = AdapterTester(message, catalog, config=self.config)
        all_items = list(adapter.get_all_catalog_items(catalog, True))
        self.assertEqual(all_items, [ *items_a, *items_b ])

    def test_unaltered_ids_are_assigned_new_uuids(self):
        catalog = Catalog('0', 'Catalog 0')
        catalog.add_link(Link('harmony_source', 'http://example.com/C0001-EXAMPLE'))

        message = Message(full_message)
        items = [
            Item('1', None, [0, 0, 1, 1], '2020-01-01T00:00:00.000Z', {}),
            Item('2', None, [0, 0, 1, 1], '2020-01-01T00:00:00.000Z', {})
        ]
        catalog.add_items(items)
        adapter = AdapterTester(message, catalog, config=self.config)
        (message, out_catalog) = adapter.invoke()
        self.assertNotEqual(out_catalog.id, catalog.id)

        out_items = [item for item in out_catalog.get_items()]
        self.assertNotEqual(out_items[0].id, items[0].id)
        self.assertNotEqual(out_items[1].id, items[1].id)

    def test_altered_ids_are_retained(self):
        catalog = Catalog('0', 'Catalog 0')
        catalog.add_link(Link('harmony_source', 'http://example.com/C0001-EXAMPLE'))

        message = Message(full_message)
        items = [
            Item('mutate-me', None, [0, 0, 1, 1], '2020-01-01T00:00:00.000Z', {}),
            Item('2', None, [0, 0, 1, 1], '2020-01-01T00:00:00.000Z', {})
        ]
        catalog.add_items(items)
        adapter = AdapterTester(message, catalog, config=self.config)
        (message, out_catalog) = adapter.invoke()
        out_items = [item for item in out_catalog.get_items()]
        self.assertEqual(out_items[0].id, 'i-mutated-you')
