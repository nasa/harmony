from base64 import b64encode
from dataclasses import dataclass, field

import pytest
from requests import Session

from harmony_service_lib.earthdata import EarthdataAuth, EarthdataSession


@dataclass
class FakeRequest:
    url: str = 'https://fake.download.earthdata.nasa.gov/data'
    headers: dict = field(default_factory=dict)


@pytest.fixture
def earthdata_auth(faker):
    token = faker.password(length=40, special_chars=False)
    return EarthdataAuth(token)


def test_authdata_auth_creates_correct_header(faker):
    token = faker.password(length=40, special_chars=False)
    auth = EarthdataAuth(token)
    request = FakeRequest()

    auth(request)

    assert 'Authorization' in request.headers
    assert 'Bearer' in request.headers['Authorization']
    assert token in request.headers['Authorization']


def test_earthdata_auth_adds_auth_header_(earthdata_auth):
    request = FakeRequest()

    earthdata_auth(request)

    assert 'Authorization' in request.headers

def test_earthdata_auth_removes_auth_header_when_X_Amz_Algorithm_is_set(earthdata_auth):
    request = FakeRequest(url='https://presigned.s3.url.com?X-Amz-Algorithm=foo')

    earthdata_auth(request)

    assert 'Authorization' not in request.headers

def test_earthdata_auth_removes_auth_header_when_signature_is_set(earthdata_auth):
    request = FakeRequest(url='https://presigned.s3.url.com?Signature=bar')

    earthdata_auth(request)

    assert 'Authorization' not in request.headers

def test_earthdata_session_given_no_auth_delegates_to_super(monkeypatch):
    called = False

    def mock_rebuild_auth(self, prepared_request, response):
        nonlocal called
        called = True
    monkeypatch.setattr(Session, 'rebuild_auth', mock_rebuild_auth)
    session = EarthdataSession()

    session.rebuild_auth(None, None)

    assert called


def test_earthdata_session_given_no_auth_header_sets_auth_header(earthdata_auth):
    session = EarthdataSession()
    session.auth = earthdata_auth
    request = FakeRequest()

    session.rebuild_auth(request, None)

    assert 'Authorization' in request.headers


def test_earthdata_session_given_auth_header_replaces_auth_header(earthdata_auth):
    session = EarthdataSession()
    session.auth = earthdata_auth
    request = FakeRequest(headers={'Authorization': 'PreExistingValue'})

    session.rebuild_auth(request, None)

    assert 'Authorization' in request.headers
    assert request.headers['Authorization'] != 'PreExistingValue'
