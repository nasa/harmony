# Testing Services

1. If you're starting from scratch, and need to know how to build a new service for Harmony, see [Adapting New Services](./guides/adapting-new-services.md). 

2. When you have a service ready to test, read the [Service Configuration](./guides/Configuring%20a%20Harmony%20service.ipynb) notebook which will help you understand how to make your collections and variables compatible with Harmony and how to add code to Harmony that will "activate" your service and link it to the relevant collections. In development mode, Harmony communicates with the UAT CMR environment, so any relevant CMR configuration will need to be completed in UAT in order for your local testing to work. You can hold off on submitting any configuration change (`services.yml`, `env-defaults`) pull requests until you're satisfied with your testing results.

Once your service has been developed and everything is configured, you can deploy it and test it locally alongside your local Harmony instance:

1. Build the image for your service
2. Add an entry for your service (lowercase) to your `.env` file:
```shell
LOCALLY_DEPLOYED_SERVICES=my-service
```
3. Run
```bash
./bin/deploy-services
```