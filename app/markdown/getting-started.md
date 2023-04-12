## Getting Started
All users will need an [Earthdata Login](edl) (EDL) account in order to access NASA data and services.
Once a user has an EDL username and password they will need to use these when accessing Harmony.
They can be used directly in a browser request (the browser will prompt for them), in another client like [curl](https://curl.se/), or in code.

For `curl` or in code the easiest approach is to place your EDL credentials in a [.netrc file](https://everything.curl.dev/usingcurl/netrc).

A sample `.netrc` file looks like this

```

machine {{edl}} login my-edl-user-name password my-edl-password

```
**Example {{exampleCounter}}** - Sample .netrc file

Make sure that this file is only readable by the current user or you will receive an error stating
"netrc access too permissive."

```
$ chmod 0600 ~/.netrc
```
**Example {{exampleCounter}}** - Setting permissions on the .netrc file (Unix/macOS)

Alternatively users can generate an EDL [bearer token]({{edl}}/documentation/for_users/user_token) directly and pass this to Harmony using an `Authorization: Bearer` header.

#### Passing credentials with curl

Use the `-n` flag to use your `.netrc` file with `curl`. You will
also need to pass the `-L` flag (to handle the redirect from Harmony to EDL and back) and
the `-b` and `-j` flags to properly handle cookies used during the authentication.

```

curl -Lnbj {{root}}/{{exampleCollection}}/ogc-api-coverages/1.0.0/collections/bathymetry/coverage/rangeset

```
**Example {{exampleCounter}}** - Curl flags to handle EDL authentication when using a .netrc file

To work directly with a bearer token from EDL you can use an `Authorization: Bearer my-bearer-token` header as follows:

```

curl -H "Authorization: Bearer <my-bearer-token>" {{root}}/{{exampleCollection}}/ogc-api-coverages/1.0.0/collections/bathymetry/coverage/rangeset

```
**Example {{exampleCounter}}** - Using a bearer token with curl

#### Passing credentials in code

The following Python example uses the `netrc`, `request`, and `cookiejar` libraries to set up authentication with EDL.
==No error handling is included in this example.==

```python

import netrc
from urllib import request, parse
from http.cookiejar import CookieJar

def setup_earthdata_login_auth(endpoint):
    """
    Set up the request library so that it authenticates against the given Earthdata Login
    endpoint and is able to track cookies between requests.  This uses the .netrc file.
    """
    username, _, password = netrc.netrc().authenticators(endpoint)
    manager = request.HTTPPasswordMgrWithDefaultRealm()
    manager.add_password(None, endpoint, username, password)
    auth = request.HTTPBasicAuthHandler(manager)

    jar = CookieJar()
    processor = request.HTTPCookieProcessor(jar)
    opener = request.build_opener(auth, processor)
    request.install_opener(opener)

setup_earthdata_login_auth('{{edl}}')

```
**Example {{exampleCounter}}** - Authenticating in python

The `username` and `password` can also be set directly instead of using a `.netrc` file.

There is significant boiler-plate code involved in connecting to Harmony that can be avoided
by using the [harmony-py](https://github.com/nasa/harmony-py) library. The equivalent code
using `harmony-py` (when using a `.netrc` file) can be as simple as

```python

from harmony import Client

harmony_client = Client() # defaults to Harmony production endpoint

```
**Example {{exampleCounter}}** - Using `harmony-py` to create a client with `.netrc` EDL authentication

`harmony-py` provides many other conveniences when using Harmony services. For these reasons
==`harmony-py` is the suggested way to access Harmony in code.== For complete details see the
[documentation](https://harmony-py.readthedocs.io/en/latest/).

<br/>
<br/>
<br/>