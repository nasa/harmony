import pytest
import responses
import os

from harmony_service_lib.http import (download, is_http, localhost_url)
from unittest.mock import Mock, patch
from tests.util import config_fixture

EDL_URL = 'https://uat.urs.earthdata.nasa.gov'

@pytest.mark.parametrize('url,expected', [
    ('http://example.com', True),
    ('HTTP://YELLING.COM', True),
    ('https://nosuchagency.org', True),
    ('hTTpS://topsecret.org', True),
    ('nothttp://topsecret.org', False),
    ('httpsnope://topsecret.org', False),
    ('s3://bucketbrigade.com', False),
    ('file:///var/log/junk.txt', False),
    ('gopher://minnesota.org', False)
])
def test_is_http(url, expected):
    assert is_http(url) is expected


@pytest.mark.parametrize('url,expected', [
    ('http://example.com/ufo_sightings.nc', 'http://example.com/ufo_sightings.nc'),
    ('http://localhost:3000/jobs', 'http://mydevmachine.local.dev:3000/jobs'),
    ('s3://localghost.org/boo.gif', 's3://localghost.org/boo.gif')
])
def test_when_given_urls_localhost_url_returns_correct_url(url, expected):
    local_hostname = 'mydevmachine.local.dev'

    assert localhost_url(url, local_hostname) == expected


@pytest.fixture
def access_token(faker):
    return faker.password(length=40, special_chars=False)

@pytest.fixture
def validate_access_token_url():
    return (f'{EDL_URL}/oauth/tokens/user'
            '?token={token}&client_id={client_id}')

@pytest.fixture
def resource_server_granule_url():
    return 'https://resource.server.daac.com/foo/bar/granule.nc'


@pytest.fixture
def response_body_from_granule_url():
    return "dummy response body"


@pytest.fixture
def resource_server_redirect_url(faker):
    return ('https://n5eil11u.ecs.nsidc.org/TS1_redirect'
            f'?code={faker.password(length=64, special_chars=False)}'
            f'&state={faker.password(length=128, special_chars=False)}')

@pytest.fixture
def edl_redirect_url(faker):
    return ('https://uat.urs.earthdata.nasa.gov/oauth/authorize'
            f'?client_id={faker.password(length=22, special_chars=False)}'
            '&response_type=code'
            '&redirect_uri=https%3A%2F%2Fn5eil11u.ecs.nsidc.org%2FTS1_redirect'
            f'&state={faker.password(length=128, special_chars=False)}')


@pytest.fixture(autouse=True)
def getsize_patched(monkeypatch):
    monkeypatch.setattr(os.path, "getsize", lambda a: 0)

@responses.activate
def test_download_follows_redirect_and_uses_auth_headers(
        mocker,
        access_token,
        resource_server_granule_url,
        edl_redirect_url):

    responses.add(
        responses.GET,
        resource_server_granule_url,
        status=302,
        headers=[('Location', edl_redirect_url)]
    )
    responses.add(
        responses.GET,
        edl_redirect_url,
        status=302
    )
    destination_file = mocker.Mock()
    cfg = config_fixture()

    response = download(cfg, resource_server_granule_url, access_token, None, destination_file)

    # We should get redirected
    assert response.status_code == 302
    assert len(responses.calls) == 2

    # We should include auth headers in both requests
    request_headers = responses.calls[0].request.headers
    redirect_headers = responses.calls[1].request.headers

    assert 'Authorization' in request_headers
    assert 'Authorization' in redirect_headers
    assert 'Bearer' in request_headers['Authorization']
    assert 'Bearer' in redirect_headers['Authorization']


@responses.activate
@patch('harmony_service_lib.http.get_retry_delay', Mock(return_value = 0))
def test_download_validates_token_and_raises_exception(
        mocker,
        faker,
        validate_access_token_url):

    client_id = faker.password(length=22, special_chars=False)
    access_token = faker.password(length=42, special_chars=False)
    cfg = config_fixture()
    url = validate_access_token_url.format(
        token=access_token,
        client_id=client_id
    )

    responses.add(responses.POST, url, status=403, json={
        "error": "invalid_token",
        "error_description": "The token is either malformed or does not exist"
    })
    destination_file = mocker.Mock()

    with pytest.raises(Exception):
        download(cfg, 'https://xyzzy.com/foo/bar', access_token, None, destination_file)
        # Assert content


@responses.activate
def test_when_given_a_url_and_data_it_downloads_with_query_parameters(
        mocker,
        access_token,
        resource_server_granule_url):

    responses.add(
        responses.POST,
        resource_server_granule_url,
        status=200
    )
    destination_file = mocker.Mock()
    cfg = config_fixture()
    data = {'param': 'value'}

    response = download(cfg, resource_server_granule_url, access_token, data, destination_file)

    assert response.status_code == 200
    assert len(responses.calls) == 1
    assert responses.calls[0].request.body == 'param=value'


@responses.activate
def test_when_authn_succeeds_it_writes_to_provided_file(
        mocker,
        access_token,
        resource_server_granule_url,
        response_body_from_granule_url):

    responses.add(
        responses.GET,
        resource_server_granule_url,
        body=response_body_from_granule_url,
        status=200
    )
    destination_file = mocker.Mock()
    cfg = config_fixture()

    response = download(cfg, resource_server_granule_url, access_token, None, destination_file)

    assert response.status_code == 200
    assert len(responses.calls) == 1
    destination_file.write.assert_called()


@responses.activate
@patch('harmony_service_lib.http.get_retry_delay', Mock(return_value = 0))
def test_download_all_retries_failed(
        mocker,
        faker,
        resource_server_granule_url):

    client_id = faker.password(length=22, special_chars=False)
    access_token = faker.password(length=42, special_chars=False)
    cfg = config_fixture()

    responses.add(
        responses.GET,
        resource_server_granule_url,
        status=599
    )
    destination_file = mocker.Mock()

    with pytest.raises(Exception):
         download(cfg, resource_server_granule_url, access_token, None, destination_file)

    assert len(responses.calls) == 5

@responses.activate
def test_user_agent_is_passed_to_request_headers_when_using_edl_auth(
        mocker,
        access_token,
        resource_server_granule_url):

    responses.add(
        responses.GET,
        resource_server_granule_url,
        status=200
    )
    destination_file = mocker.Mock()
    cfg = config_fixture()

    user_agent = 'test-agent/0.0.0'
    download(cfg, resource_server_granule_url, access_token, None, destination_file, user_agent=user_agent)

    assert 'User-Agent' in responses.calls[0].request.headers
    assert user_agent in responses.calls[0].request.headers['User-Agent']

@responses.activate
def test_user_agent_is_passed_to_request_headers_when_using_edl_auth_and_post_param(
        mocker,
        access_token,
        resource_server_granule_url):

    responses.add(
        responses.POST,
        resource_server_granule_url,
        status=200
    )
    destination_file = mocker.Mock()
    cfg = config_fixture()
    data = {'param': 'value'}

    user_agent = 'test-agent/0.0.0'
    download(cfg, resource_server_granule_url, access_token, data, destination_file, user_agent=user_agent)

    assert 'User-Agent' in responses.calls[0].request.headers
    assert user_agent in responses.calls[0].request.headers['User-Agent']

RETRY_ERROR_CODES = [400, 404, 500, 502, 503]

@responses.activate(registry=responses.registries.OrderedRegistry)
@pytest.mark.parametrize('error_code', [RETRY_ERROR_CODES])
@patch('harmony_service_lib.http.get_retry_delay', Mock(return_value = 0))
def test_retries_on_temporary_errors_edl_auth(
        mocker,
        access_token,
        resource_server_granule_url,
        error_code):
    rsp1 = responses.get(resource_server_granule_url, body="Error", status=error_code)
    rsp2 = responses.get(resource_server_granule_url, body="Error", status=error_code)
    rsp3 = responses.get(resource_server_granule_url, body="OK", status=200)

    destination_file = mocker.Mock()
    cfg = config_fixture(max_download_retries=5)

    response = download(cfg, resource_server_granule_url, access_token, None, destination_file)

    assert response.status_code == 200
    assert rsp1.call_count == 1
    assert rsp2.call_count == 1
    assert rsp3.call_count == 1
