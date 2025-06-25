from urllib.parse import urlparse, parse_qs
from requests.auth import AuthBase
from requests import Session


def _is_presigned_url(url: str) -> bool:
    """Check if the URL is an AWS presigned URL. For AWS presigned URLs we do not
    want to pass in an authorization header."""
    query_params = parse_qs(urlparse(url).query)
    return "X-Amz-Algorithm" in query_params or "Signature" in query_params


class EarthdataSession(Session):
    """Session which ensures the Authorization header is sent to correct
    servers.

    After instantiating the EarthdataSession, set its `auth` attribute
    to a valid EarthdataAuth instance:

        session.auth = EarthdataAuth(...)

    This lifecycle method on requests.Session is called when handling
    redirect requests.
    """
    def rebuild_auth(self, prepared_request, response):
        # If not configured with an EarthdataAuth instance, defer to default behavior
        if not self.auth:
            return super().rebuild_auth(prepared_request, response)

        self.auth(prepared_request)


class EarthdataAuth(AuthBase):
    """Custom Earthdata Auth provider to add EDL Authorization headers."""

    def __init__(self, user_access_token: str):
        self.authorization_header = f"Bearer {user_access_token}"

    def __call__(self, r):
        """Add Authorization headers unless the request is to an AWS presigned URL."""
        if _is_presigned_url(r.url):
            r.headers.pop('Authorization', None)
        else:
            r.headers["Authorization"] = self.authorization_header

        return r
