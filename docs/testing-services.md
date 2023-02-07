# Testing Services

If you're building from scratch, see the [Production Readiness Guide](https://wiki.earthdata.nasa.gov/display/HARMONY/Harmony+Service+Production+Readiness+Guide) which will give a high-level overview of everything you need to know and will point you to particular technical guides in this repository when appropriate. If you're already somewhat comfortable with the Harmony community development model and are only looking for technical guidance, the [guides directory](guides) should have everything you need for development. 

Once your service has been developed and everything is configured, you can deploy it and test it locally alongside your local Harmony instance. Hold off on submitting any configuration change (`services.yml`, `env-defaults`) pull requests until you're satisfied with your testing results:

1. Build the image for your service
2. Add an entry for your service (lowercase) to your `.env` file:
```shell
LOCALLY_DEPLOYED_SERVICES=my-service
```
3. Run
```bash
./bin/deploy-services
```