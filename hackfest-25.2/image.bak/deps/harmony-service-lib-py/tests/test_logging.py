import unittest
import copy
from io import StringIO

from harmony_service_lib.logging import build_logger
from tests.util import config_fixture
from harmony_service_lib.message import Message
from .example_messages import minimal_message


class TestLoggingRedaction(unittest.TestCase):

    def setUp(self):
        self.harmony_message = Message(minimal_message)
        self.token = self.harmony_message.accessToken
        self.buffer = StringIO()

    def configure_logger(self, text_logger):
        self.logger = build_logger(
            config_fixture(text_logger=text_logger), 
            stream=self.buffer)

    def test_msg_token_not_logged(self):
        self.configure_logger(text_logger=False)
        self.logger.info(self.harmony_message)
        log = self.buffer.getvalue()
        assert("accessToken = '<redacted>'" in log)
        assert(self.token not in log) 
        # check the same but with the text logger
        self.configure_logger(text_logger=True)
        self.logger.info(self.harmony_message)
        log = self.buffer.getvalue()
        assert("accessToken = '<redacted>'" in log)
        assert(self.token not in log)
        # check that the message wasn't mutated
        assert(self.harmony_message.accessToken == self.token)

    def test_arg_token_not_logged(self):
        log_call_arguments = ['the Harmony message is %s', self.harmony_message]
        self.configure_logger(text_logger=False)
        self.logger.info(*log_call_arguments)
        log = self.buffer.getvalue()
        assert("accessToken = '<redacted>'" in log)
        assert(self.token not in log)
        # check the same but with the text logger
        self.configure_logger(text_logger=True)
        self.logger.info(*log_call_arguments)
        log = self.buffer.getvalue()
        assert("accessToken = '<redacted>'" in log)
        assert(self.token not in log)
        # check that the message wasn't mutated
        assert(self.harmony_message.accessToken == self.token)

    def test_multiple_args_token_not_logged(self):
        log_call_arguments = ['the Harmony message is %s. Another arg: %s', self.harmony_message, "another arg"]
        self.configure_logger(text_logger=False)
        self.logger.info(*log_call_arguments)
        log = self.buffer.getvalue()
        assert("accessToken = '<redacted>'" in log)
        assert(self.token not in log)
        # check the same but with the text logger
        self.configure_logger(text_logger=True)
        self.logger.info(*log_call_arguments)
        log = self.buffer.getvalue()
        assert("accessToken = '<redacted>'" in log)
        assert(self.token not in log)
        # check that the message wasn't mutated
        assert(self.harmony_message.accessToken == self.token)

    def test_dict_token_not_logged(self):
        log_call_arguments = ['the Harmony message is %s', { 'the_harmony_message': self.harmony_message }]
        self.configure_logger(text_logger=False)
        self.logger.info(*log_call_arguments)
        log = self.buffer.getvalue()
        assert("accessToken = '<redacted>'" in log)
        assert(self.token not in log)
        # check the same but with the text logger
        self.configure_logger(text_logger=True)
        self.logger.info(*log_call_arguments)
        log = self.buffer.getvalue()
        assert("accessToken = '<redacted>'" in log)
        assert(self.token not in log)
        # check that the message wasn't mutated
        assert(self.harmony_message.accessToken == self.token)
        
        