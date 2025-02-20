# Harmony Cron Service

This folder contains the code and build scripts for the Harmony cron service,
which schedules periodic jobs needed by harmony.

## Building the Cron Service for Local Use

1. Run `npm build` in this directory to build with the tag `latest`. To use a different tag,
   run `VERSION=tag npm run build`.

## Using the Cron Service Locally

1. If you are using an image tag other than `latest` set `CRON_SERVICE_IMAGE=harmonyservices/cron-service:<tag>` in your harmony .env file
2. Run `bin/deploy-services` from the harmony repository

## Running the Cron Service Outside of Docker for Development

If you are doing development of the cron service itself it is convenient to run it as a stand-alone
process outside of Docker.
1. `kubectl delete deployment harmony-cron-service -n harmony`
2. `kubectl delete service harmony-cron-service -n harmony`
3. `DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres npm run start-dev-fast` (from this directory)

## Adding New Cron Jobs

There are two steps for adding new jobs:
1. Implement a class that extends the `CronJob` class. This class must override the static `run`
   method in `CronJob`. Place the file for this class under the `app/cronjobs` directory.
2. Add an environment variable to `env.ts` and `environment-defaults` that holds
   holds the cron spec for the schedule for the service. See the
   `WORK_REAPER_CRON` in `env-defaults` for an example.
   See [here](https://www.npmjs.com/package/croner#pattern) for details about the crontab format.

3. Add an entry in the `cronEntries` array in `server.ts`. This entry should consists of an
   array containing the environment variable from step 2 and the class that you
   implemented in step 1. See the entry for the `WorkReaper` class for an example.

## Pushing the Docker Image to ECR

If you want to do sandbox deployments with your custom cron service image then you need to
push it to ECR. This can be done as follows:

1. (only needed if building on Mac to build for AMD64 architecture)
   `VERSION=<image-tag> npm run build-m1`
2. `bin/push-image <image-tag>`

This requires you to have your AWS credentials set for your sandbox.