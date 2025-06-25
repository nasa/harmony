import harmony_service_lib


def get_version():
    """
    Get the version of the currently running service lib.

    Returns
    -------
    string
        A string representing the current version.
    """
    return harmony_service_lib.__version__
