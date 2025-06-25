class HarmonyException(Exception):
    """Base class for Harmony exceptions.

    Attributes
    ----------
    message : string
        Explanation of the error
    category : string
        Classification of the type of harmony error
    level : string
        The level of the error, can be 'Error' or 'Warning'.
    """

    def __init__(self, message, category='Service', level='Error'):
        self.message = message
        self.category = category
        self.level = level


class CanceledException(HarmonyException):
    """Class for throwing an exception indicating a Harmony request has been canceled"""

    def __init__(self, message=None):
        super().__init__(message, 'Canceled')


class ForbiddenException(HarmonyException):
    """Class for throwing an exception indicating download failed due to not being able to access the data"""

    def __init__(self, message=None):
        super().__init__(message, 'Forbidden')


class ServerException(HarmonyException):
    """Class for throwing an exception indicating the download failed due to a generic 500 internal server error """

    def __init__(self, message=None):
        super().__init__(message, 'Server')


class NoDataException(HarmonyException):
    """Class for throwing an exception indicating service found no data to process """

    def __init__(self, message='No data found to process'):
        super().__init__(message, 'NoData', 'Warning')
