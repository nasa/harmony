from unittest import TestCase

from freezegun import freeze_time

from harmony_service_lib.provenance import get_updated_history_metadata


@freeze_time('2001-02-03T04:05:06')
class TestProvenance(TestCase):
    """Test class for functions in harmony_service_lib.provenance."""

    def test_get_updated_history_metadata_existing_history(self):
        """A new line should be appended to the existing history metadata."""
        self.assertEqual(
            get_updated_history_metadata(
                'Amazing Service',
                '1.2.3',
                '1999-12-11T10:09:08 File created',
            ),
            '1999-12-11T10:09:08 File created\n2001-02-03T04:05:06+00:00 Amazing Service 1.2.3',
        )

    def test_get_updated_history_metadata_no_existing_history(self):
        """The output should only be the newly created history metadata."""
        self.assertEqual(
            get_updated_history_metadata(
                'Amazing Service',
                '1.2.3',
            ),
            '2001-02-03T04:05:06+00:00 Amazing Service 1.2.3',
        )
