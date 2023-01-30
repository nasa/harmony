# Testing New Services

If you are developing a service and wish to test it locally with Harmony then you must
define the environment variables needed to run the service and execute the local deployment script.
You can do this with the following steps:

1. Build the image for your service
2. Add entries into the `env-defaults` file for your service. See the `HARMONY_SERVICE_EXAMPLE`
   entries for examples. Be sure to prefix the entries with the name of your service.
   Set the value for the `INVOCATION_ARGS` environment variable. This should be how you would run
  your service from the command line. For example, if you had a python module named `my-service`
  in the working directory, then you would run the service using
  ```bash
  python -m my-service
  ```
  So your entry for `INVOCATION_ARGS` would be
  ```shell
  MY_SERVICE_INVOCATION_ARGS='python -m my-service'
  ```
3. Add an entry for your service (lowercase) to the `.env` file:
```shell
LOCALLY_DEPLOYED_SERVICES=my-service
```
Note that the name used must be the kebab case version of the environment variable prefix used in `env-defaults`.
4. Run
```bash
./bin/deploy-services
```