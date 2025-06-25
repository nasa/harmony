import os
import unittest
from unittest.mock import patch

import harmony_service_lib.util
from harmony_service_lib import cli, BaseHarmonyAdapter
from pystac import Catalog
from tests.util import cli_test


class MockAdapter(BaseHarmonyAdapter):
    """
    Dummy class to mock adapter calls and record the input messages
    """
    messages = []
    errors = []
    cleaned_up = []
    result_catalog = Catalog(
        id='example id',
        description='An empty STAC catalog',
        stac_extensions=[]
    )

    def __init__(self, message, catalog=None):
        super().__init__(message, catalog)
        MockAdapter.messages.append(message.data)

    def invoke(self):
        return (self.message, self.result_catalog)

    def cleanup(self):
        MockAdapter.cleaned_up.append(True)


class TestIsHarmonyCli(unittest.TestCase):
    @cli_test('--something-else', 'invoke')
    def test_when_not_passing_harmony_action_it_returns_false(self, parser):
        parser.add_argument('--something-else')
        args = parser.parse_args()
        self.assertFalse(cli.is_harmony_cli(args))

    @cli_test('--harmony-action', 'invoke')
    def test_when_passing_harmony_action_it_returns_true(self, parser):
        args = parser.parse_args()
        self.assertTrue(cli.is_harmony_cli(args))

    @cli_test()
    def test_when_passing_nothing_it_returns_false(self, parser):
        args = parser.parse_args()
        self.assertFalse(cli.is_harmony_cli(args))


class TestCliInvokeAction(unittest.TestCase):
    def setUp(self):
        self.config = harmony_service_lib.util.config(validate=False)
        with open('/tmp/operation.json', 'w') as f:
            f.write('{"test": "input"}')

    def tearDown(self):
        os.remove('/tmp/operation.json')
        MockAdapter.messages = []
        MockAdapter.errors = []
        MockAdapter.cleaned_up = []

    @cli_test('--harmony-action', 'invoke')
    def test_when_harmony_input_is_not_provided_it_terminates_with_error(self, parser):
        with patch.object(parser, 'error') as error_method:
            args = parser.parse_args()
            cli.run_cli(parser, args, MockAdapter, self.config)
            error_method.assert_called_once_with(
                '--harmony-input or --harmony-input-file must be provided for --harmony-action=invoke')

    @cli_test('--harmony-action', 'invoke', '--harmony-input', '{"test": "input"}')
    def test_when_harmony_metadata_dir_is_not_provided_it_terminates_with_error(self, parser):
        with patch.object(parser, 'error') as error_method:
            args = parser.parse_args()
            cli.run_cli(parser, args, MockAdapter, self.config)
            error_method.assert_called_once_with(
                '--harmony-metadata-dir must be provided for --harmony-action=invoke')

    @cli_test('--harmony-action', 'invoke', '--harmony-input', '{"test": "input"}', '--harmony-metadata-dir', '/tmp')
    def test_when_harmony_input_is_provided_it_creates_and_invokes_an_adapter(self, parser):
        args = parser.parse_args()
        cli.run_cli(parser, args, MockAdapter, self.config)
        self.assertListEqual([{'test': 'input'}], MockAdapter.messages)

    @cli_test('--harmony-action', 'invoke', '--harmony-input-file', '/tmp/operation.json', '--harmony-metadata-dir', '/tmp')
    def test_when_harmony_input_file_is_provided_it_creates_and_invokes_an_adapter(self, parser):
        args = parser.parse_args()

        cli.run_cli(parser, args, MockAdapter, self.config)
        self.assertListEqual([{'test': 'input'}], MockAdapter.messages)

    @cli_test('--harmony-action', 'invoke', '--harmony-input', '{"test": "input"}', '--harmony-metadata-dir', '/tmp')
    def test_when_the_backend_service_throws_an_exception_after_response_it_does_not_respond_again(self, parser):
        class MockImpl(MockAdapter):
            def invoke(self):
                raise Exception('Something bad happened')

        args = parser.parse_args()
        try:
            cli.run_cli(parser, args, MockImpl, self.config)
        except Exception:
            pass
        self.assertListEqual(MockImpl.errors, [])

if __name__ == '__main__':
    unittest.main()
