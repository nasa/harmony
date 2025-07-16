# Performance and load testing

The files in this directory are to support performance and load testing against Harmony. The
testing is performed using [locust.io](https://locust.io/).

## Installation
```
$ pip install -r requirements.txt
```

## Required environment variables
All harmony requests will require authentication with EDL. Set the `WORKLOAD_BEARER_TOKEN` environment variable to
an EDL bearer token for your user in the appropriate environment for your run (either UAT or production).

## Running
To start a new performance test execute the following:
```
$ locust
```

You can also limit the test cases run based on tags. For example to only run synchronous requests:
```
$ locust --tags sync
```

For a full listing of capabilities see the [locust documentation](https://docs.locust.io/en/stable/index.html).

### Using a proxy
You can use a socks proxy to execute a run against a sandbox environment which does not have direct access. For
example if you open a tunnel to port 8080 you can then run the following to allow access to sandbox resources:
```
$ HTTPS_PROXY=socks5h://localhost:8080 locust
```

### Sandbox SSL certificates
Note that you will also need to provide the EDC certificate in order to successfully connect to the load balancer
in the sandbox environment. Save the EDC SSL certificate to a file locally and then run:
```
REQUESTS_CA_BUNDLE=<local PEM file> WORKLOAD_BEARER_TOKEN=$UAT_BEARER HTTPS_PROXY=socks5h://localhost:8080 locust --exclude-tags uat
```

#### Testing synchronous requests in sandbox
Note that synchronous requests are marked as failed in the Locust UI when running against a sandbox environment
due to both AWS internal and EDC certificates being needed because of the redirect to stream back the data.

### Locust UI
After starting locust, bring up a web browser pointing to http://localhost:8089 to define the number
of concurrent requests, and which endpoint to test (e.g. http://localhost:3000 or
https://harmony.sit.earthdata.nasa.gov). Click 'Start swarming' and the test will begin. Click 'Stop' when
you want to end the test.

### Running against production collections
By default requests will be run against CMR UAT collections. In order to run against production collections
use the production locustfile.
```
$ locust -f locustfile-prod.py
```

## Generating performance charts
After performing a run, save a results report CSV using the Locust UI. Bring up the performance-charts Jupyter
notebook. Modify the data sources it uses from the provided examples to the CSV report you just saved. If you
want to compare multiple runs add each CSV filename to the list of data files to chart. Then, run all the cells
in the notebook.

## Linter
Make sure to install the dev dependencies:
```
$ pip install -r dev-requirements.txt
```

Then run:
```
$ flake8
```
