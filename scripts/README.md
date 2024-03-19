# Clean up old services

As new backend provider services are deployed in Harmony, old service deployments, services, hpas and pods are left behind in Harmony Kubernetes cluster. Those artifacts of old services that are no longer used (i.e. services without any active or paused requests and will also not receive new requests) and should be cleaned up. The `cleanup_old_services.py` script can be used to clean them up.

# Development Environment

## Prerequisites
* [Python](https://www.python.org/)

## Installation and Environment Variables
* brew install python3
* pip3 install python-dotenv
* pip3 install psycopg2
* export AWS_PROFILE=<harmony-aws-profile>
* export KUBE_CONFIG=<kubernetes-config-file-path>
* export DB_PASSWORD=<harmony-db-password>

## Run cleanup script
See NOTE below before running the script.

`python3 cleanup_old_services.py -h` to see the script usage.

e.g. `python3 cleanup_old_services.py sandbox` to run the script in Harmony Sandbox environment.

NOTE:
- Make sure you can access Harmony database (via tunnel to localhost:1234) in the corresponding Harmony environment that you want to perform the cleanup.
- `AWS_PROFILE` environment variable must conform to the naming convention of `harmony-<environment_name>` where `<environment_name>` is the environment name passed to the cleanup script. E.g. for `sandbox` environment, the AWS_PROFILE must be set to `harmony-sandbox` where AWS credentials for the Sandbox environment is provided.
- `KUBE_CONFIG` environment variable must be set to the full path of kubernetes config file, e.g. `/Users/yliu10/.kube/harmony-yliu10`.
- `DB_PASSWORD` environment variable must have the correct password for Harmony database.

## License

Copyright © 2024 NASA
