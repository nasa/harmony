"""Utility functionality for generating provenance metadata."""
from __future__ import annotations

from datetime import datetime

try:
    # datetime.UTC added in Python 3.11
    from datetime import UTC
except ImportError:
    from datetime import timezone
    UTC = timezone.utc


def get_updated_history_metadata(
    service_name: str,
    service_version: str,
    existing_history: str | None = None,
) -> str:
    """Create updated history global attribute.

    This function primarily ensures the correct formatting of the history
    string, and is agnostic to the format of the input file.

    Parameters
    ----------
        service_name : str
            The name of the service processing a file.
        service_version : str
            The semantic version number of the service processing a file.
        existing_history : str, optional
            Any existing content from a "history" or "History" metadata
            attribute, to which new information should be appended.

    Returns
    -------
        str
            Updated value for history metadata attribute. If an existing
            history value was supplied, the new information is appended to that
            value, and delimited by a newline.

    """
    new_history_line = ' '.join(
        [
            datetime.now(UTC).isoformat(),
            service_name,
            service_version,
        ]
    )

    return '\n'.join(
        filter(None, [existing_history, new_history_line])
    )
