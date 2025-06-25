import datetime as dt
from functools import lru_cache
import logging
import sys
import copy

from pythonjsonlogger import jsonlogger
from harmony_service_lib import message


class HarmonyJsonFormatter(jsonlogger.JsonFormatter):
    """A JSON log entry formatter."""
    def add_fields(self, log_record, record, message_dict):
        super(HarmonyJsonFormatter, self).add_fields(
            log_record, record, message_dict)
        if not log_record.get('timestamp'):
            now = dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')
            log_record['timestamp'] = now
        if log_record.get('level'):
            log_record['level'] = log_record['level'].upper()
        else:
            log_record['level'] = record.levelname
        if not log_record.get('application'):
            log_record['application'] = self.app_name


class RedactorFormatter(object):
    """Redacts sensitive information from logs."""
    def __init__(self, original_formatter):
        self.original_formatter = original_formatter

    def format(self, record):
        # need to check the log record's msg and args for sensitive values
        # https://docs.python.org/3/library/logging.html#logrecord-attributes
        msg_clone = None
        args_clone = None
        if isinstance(record.msg, message.Message):
            msg_clone = copy.deepcopy(record.msg)
            msg_clone.accessToken = '<redacted>'
        if isinstance(record.args, dict):
            for k in record.args.keys():
                if isinstance(record.args[k], message.Message):
                    if not args_clone:
                        args_clone = copy.deepcopy(record.args)
                    args_clone[k].accessToken = '<redacted>'
        else:  # args is a tuple
            for index, arg in enumerate(record.args):
                if isinstance(arg, message.Message):
                    if not args_clone:
                        args_clone = copy.deepcopy(record.args)
                    args_clone[index].accessToken = '<redacted>'
        if msg_clone:
            record.msg = msg_clone
        if args_clone:
            record.args = args_clone
        formatted_message = self.original_formatter.format(record)
        return formatted_message

    def __getattr__(self, attr):
        return getattr(self.original_formatter, attr)


@lru_cache(maxsize=128)
def build_logger(config, name='harmony-service', stream=None):
    """
    Builds a logger with appropriate defaults for Harmony
    Parameters
    ----------
    config : harmony_service_lib.util.Config
        The configuration values for this runtime environment.
    name : string
        The name of the logger
    stream :
        The stream to write to (optional)

    Returns
    -------
    logger : Logging
        A logger for service output
    """
    logger = logging.getLogger(name)
    syslog = logging.StreamHandler(stream)
    if config.text_logger:
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] [%(name)s.%(funcName)s:%(lineno)d] %(message)s")
    else:
        formatter = HarmonyJsonFormatter()
        formatter.app_name = config.app_name
    syslog.setFormatter(RedactorFormatter(formatter))
    logger.addHandler(syslog)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


def setup_stdout_log_formatting(config):
    """
    Updates sys.stdout and sys.stderr to pass messages through the Harmony log formatter.
    """
    # See https://stackoverflow.com/questions/11124093/redirect-python-print-output-to-logger/11124247
    class StreamToLogger(object):
        def __init__(self, logger, log_level=logging.INFO):
            self.logger = logger
            self.log_level = log_level
            self.linebuf = ''

        def write(self, buf):
            temp_linebuf = self.linebuf + buf
            self.linebuf = ''
            for line in temp_linebuf.splitlines(True):
                if line[-1] == '\n':
                    self.logger.log(self.log_level, line.rstrip())
                else:
                    self.linebuf += line

        def flush(self):
            if self.linebuf != '':
                self.logger.log(self.log_level, self.linebuf.rstrip())
            self.linebuf = ''
    sys.stdout = StreamToLogger(build_logger(config), logging.INFO)
    sys.stderr = StreamToLogger(build_logger(config), logging.ERROR)
