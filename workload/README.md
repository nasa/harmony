# Performance and load testing

The files in this directory are to support performance and load testing against Harmony. The
testing is performed using [locust.io](https://locust.io/).

## Installation
`$ pip install -r requirements.txt`

## Running

To start a new performance test execute the following:
`$ locust`

You can also limit the test cases run based on tags. For example to only run synchronous requests:
`$ locust --tags sync`

For a full listing of capabilities see the [locust documentation](https://docs.locust.io/en/stable/index.html).

After starting locust, bring up a web browser pointing to http://localhost:8089 to define the number
of concurrent requests, and which endpoint to test (e.g. http://localhost:3000 or
https://harmony.sit.earthdata.nasa.gov). Click 'Start swarming' and the test will begin. Click 'Stop' when
you want to end the test.
