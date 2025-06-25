from unittest import mock
from unittest.mock import Mock, patch

import pytest
import responses

from harmony_service_lib.exceptions import ForbiddenException, ServerException
from harmony_service_lib import util
from tests.util import config_fixture


@pytest.mark.parametrize('url,expected', [
    ('file:///var/log/junk.txt', '/var/log/junk.txt'),
    ('file:///var/logs/virus_scan.txt', '/var/logs/virus_scan.txt'),
    ('/var/logs/game_scores.txt', '/var/logs/game_scores.txt')
])
def test_url_as_filename(url, expected):
    fn = str(util._url_as_filename(url))

    assert fn == expected


def test_when_given_an_s3_uri_it_downloads_the_s3_file(monkeypatch, mocker, faker):
    access_token = faker.password(length=40, special_chars=False)
    aws_download = mocker.Mock()
    monkeypatch.setattr(util.aws, 'download', aws_download)
    config = config_fixture()

    with mock.patch('builtins.open', mock.mock_open()):
        util.download('s3://example/file.txt', 'tmp', access_token=access_token, cfg=config)

    aws_download.assert_called()


def test_when_given_an_http_url_it_downloads_the_url(monkeypatch, mocker, faker):
    access_token = faker.password(length=40, special_chars=False)
    http_download = mocker.Mock()
    monkeypatch.setattr(util.http, 'download', http_download)
    config = config_fixture()

    with mock.patch('builtins.open', mock.mock_open()):
        util.download('https://example.com/file.txt', 'tmp', access_token=access_token, cfg=config)

    http_download.assert_called()


@patch('harmony_service_lib.http.get_retry_delay', Mock(return_value = 0))
def test_when_given_unknown_url_it_raises_exception(faker):
    access_token = faker.password(length=40, special_chars=False)
    config = config_fixture()

    with mock.patch('builtins.open', mock.mock_open()):
        with pytest.raises(Exception):
            util.download('msdos:choplifter.bas', 'tmp', access_token=access_token, cfg=config)


def test_when_given_a_file_url_it_returns_the_file_path(monkeypatch, mocker, faker):
    access_token = faker.password(length=40, special_chars=False)
    http_download = mocker.Mock()
    monkeypatch.setattr(util.http, 'download', http_download)
    config = config_fixture()

    with mock.patch('builtins.open', mock.mock_open()):
        destination_path = util.download('https://example.com/file.txt', '/put/file/here/',
                                         access_token=access_token, cfg=config)

        assert destination_path.startswith('/put/file/here/')
        assert destination_path.endswith('.txt')


def test_when_given_a_file_path_it_returns_the_file_path(monkeypatch, mocker, faker ):
    access_token = faker.password(length=40, special_chars=False)
    http_download = mocker.Mock()
    monkeypatch.setattr(util.http, 'download', http_download)
    config = config_fixture()

    with mock.patch('builtins.open', mock.mock_open()):
        destination_path = util.download('file:///var/logs/example/file.txt', '/put/file/here/',
                                         access_token=access_token, cfg=config)

        assert destination_path.startswith('/var/logs/example/')
        assert destination_path.endswith('.txt')


def test_when_given_file_url_with_parameters_returns_file_path(monkeypatch,
                                                               mocker, faker):
    access_token = faker.password(length=40, special_chars=False)
    http_download = mocker.Mock()
    monkeypatch.setattr(util.http, 'download', http_download)
    config = config_fixture()

    with mock.patch('builtins.open', mock.mock_open()):
        destination_path = util.download(
            'https://example.com/file.nc4?dap4.ce=latitude',
            '/put/file/here/', access_token=access_token, cfg=config
        )

        assert destination_path.startswith('/put/file/here/')
        assert destination_path.endswith('.nc4')


@responses.activate
def test_when_the_url_returns_a_401_it_throws_a_forbidden_exception(faker):
    access_token = faker.password(length=40, special_chars=False)
    url = 'https://example.com/file.txt'
    config = config_fixture()

    responses.add(responses.GET, url, status=401)

    with mock.patch('builtins.open', mock.mock_open()):
        with pytest.raises(ForbiddenException) as e:
            util.download(url, '/tmp', access_token=access_token, cfg=config)
        assert e.value.message.startswith('Forbidden')
        assert len(responses.calls) == 1


@responses.activate
def test_when_the_url_returns_a_403_it_throws_a_forbidden_exception(faker):
    access_token = faker.password(length=41, special_chars=False)
    url = 'https://example.com/file.txt'
    config = config_fixture()
    responses.add(responses.GET, url, status=403)

    with mock.patch('builtins.open', mock.mock_open()):
        with pytest.raises(ForbiddenException) as e:
            util.download(url, '/tmp', access_token=access_token, cfg=config)
        assert e.value.message.startswith('Forbidden')
        assert len(responses.calls) == 1


@responses.activate
def test_when_the_url_returns_a_eula_error_it_returns_a_human_readable_message(faker):
    access_token = faker.password(length=42, special_chars=False)
    url = 'https://example.com/file.txt'
    config = config_fixture()
    responses.add(
        responses.GET, url, status=403,
        body=('{"status_code":403,"error_description":"EULA Acceptance Failure",'
              '"resolution_url":"https://example.com/approve_app?client_id=foo"}')
    )

    with mock.patch('builtins.open', mock.mock_open()):
        with pytest.raises(ForbiddenException) as e:
            util.download(url, '/tmp', access_token=access_token, cfg=config)
        assert e.value.message == (f'Request could not be completed because you need to agree to the EULA '
                                   f'at https://example.com/approve_app?client_id=foo')
        assert len(responses.calls) == 1


@responses.activate
@patch('harmony_service_lib.http.get_retry_delay', Mock(return_value = 0))
def test_when_the_url_returns_a_500_it_does_not_raise_a_forbidden_exception_and_does_not_return_details_to_user(faker):
    access_token = faker.password(length=43, special_chars=False)
    url = 'https://example.com/file.txt'
    config = config_fixture()
    responses.add(
        responses.POST,
        'https://uat.urs.earthdata.nasa.gov/oauth/tokens/user',
        status=200,
        match_querystring=False
    )
    responses.add(responses.GET, url, status=500)

    with mock.patch('builtins.open', mock.mock_open()):
        with pytest.raises(Exception) as e:
            util.download(url, '/tmp', access_token=access_token, cfg=config)
        assert e.type != ForbiddenException and e.type == ServerException
        assert len(responses.calls) == 5
