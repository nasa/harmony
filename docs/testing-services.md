# Testing Services

If you're building from scratch, see the [Production Readiness Guide](https://wiki.earthdata.nasa.gov/display/HARMONY/Harmony+Service+Production+Readiness+Guide) which will give a high-level overview of everything you need to know and will point you to particular technical guides in this repository when appropriate. If you're already somewhat comfortable with the Harmony community development model and are only looking for technical guidance, the [guides directory](guides) should have everything you need for service development.

Once your service has been developed and everything is configured (UMM, `services-uat.yml`, `env-defaults`), you can test it alongside your locally running Harmony instance. (Hold off on submitting any configuration change pull requests until you're satisfied with your testing results.)

1. Build the image for your service
2. Add an entry for your service (lowercase) to your `.env` file:
```shell
LOCALLY_DEPLOYED_SERVICES=my-service
```
3. Run
```bash
./bin/deploy-services
```

If you want to change the log level for your service while testing, you can add an entry to your
`.env` file like this
```bash
<SERVICE_NAME>_LOG_LEVEL=<LOG_LEVEL>
```
Where `<SERVICE_NAME>` is the name of your service, e.g., `HARMONY_SERVICE_EXAMPLE`.
`LOG_LEVEL` can be one of
    "CRITICAL"
    "FATAL"
    "ERROR"
    "WARNING"
    "INFO"
    "DEBUG"